/**
 * Inlay hints provider for hledger language server
 *
 * Provides inline, non-intrusive information:
 * - Inferred amounts on postings without explicit amounts
 * - Running balances after each posting
 * - Cost conversions when costs are involved
 */

import { InlayHint, InlayHintKind, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Transaction, Posting } from '../types';

export interface InlayHintsSettings {
  /** Show inferred amounts on postings without explicit amounts */
  showInferredAmounts?: boolean;
  /** Show running balance after each posting */
  showRunningBalances?: boolean;
  /** Show cost conversions (e.g., "= $135") */
  showCostConversions?: boolean;
}

const DEFAULT_SETTINGS: Required<InlayHintsSettings> = {
  showInferredAmounts: true,
  showRunningBalances: false,  // Can be noisy, off by default
  showCostConversions: true
};

export class InlayHintsProvider {
  /**
   * Format an amount with proper commodity placement
   */
  private formatAmount(quantity: number, commodity: string, parsed: ParsedDocument): string {
    // Find commodity format if available
    const commodityInfo = parsed.commodities.find(c => c.name === commodity);

    // Determine commodity placement
    let commodityBefore = '';
    let commodityAfter = '';

    if (commodityInfo?.format) {
      if (commodityInfo.format.symbolOnLeft) {
        commodityBefore = commodityInfo.format.symbol || commodity;
      } else {
        commodityAfter = commodityInfo.format.symbol || commodity;
      }
    } else if (commodity) {
      // Default heuristic: common currencies go on left
      const leftSymbols = ['$', '€', '£', '¥'];
      if (leftSymbols.includes(commodity)) {
        commodityBefore = commodity;
      } else {
        commodityAfter = ' ' + commodity;
      }
    }

    // Format the number
    const formattedNumber = quantity.toFixed(2);

    // Build the formatted amount
    return commodityBefore + formattedNumber + commodityAfter;
  }

  /**
   * Provide inlay hints for a document
   */
  provideInlayHints(
    document: TextDocument,
    range: Range,
    parsed: ParsedDocument,
    settings?: InlayHintsSettings
  ): InlayHint[] {
    const config = { ...DEFAULT_SETTINGS, ...settings };
    const hints: InlayHint[] = [];

    // Only process transactions within the requested range
    for (const transaction of parsed.transactions) {
      const txLine = transaction.line ?? 0;

      // Skip transactions outside the range
      if (txLine < range.start.line || txLine > range.end.line) {
        continue;
      }

      // Inferred amount hints
      if (config.showInferredAmounts) {
        hints.push(...this.getInferredAmountHints(document, transaction, parsed));
      }

      // Running balance hints
      if (config.showRunningBalances) {
        hints.push(...this.getRunningBalanceHints(document, transaction, parsed));
      }

      // Cost conversion hints
      if (config.showCostConversions) {
        hints.push(...this.getCostConversionHints(document, transaction, parsed));
      }
    }

    return hints;
  }

  /**
   * Get hints for inferred amounts (postings without explicit amounts)
   */
  private getInferredAmountHints(document: TextDocument, transaction: Transaction, parsed: ParsedDocument): InlayHint[] {
    const hints: InlayHint[] = [];

    // Calculate which posting(s) have inferred amounts
    const postingsWithAmounts = transaction.postings.filter(p => p.amount);

    // If all postings have amounts, nothing to infer
    if (postingsWithAmounts.length === transaction.postings.length) {
      return hints;
    }

    // Calculate the inferred amount(s)
    // Group by commodity
    const balances = new Map<string, number>();

    for (const posting of transaction.postings) {
      if (posting.amount) {
        // Use cost commodity if cost is present
        if (posting.cost) {
          const costCommodity = posting.cost.amount.commodity || '';
          let costValue: number;

          if (posting.cost.type === 'unit') {
            costValue = posting.amount.quantity * posting.cost.amount.quantity;
          } else {
            costValue = posting.cost.amount.quantity;
          }

          const current = balances.get(costCommodity) || 0;
          balances.set(costCommodity, current + costValue);
        } else {
          const commodity = posting.amount.commodity || '';
          const current = balances.get(commodity) || 0;
          balances.set(commodity, current + posting.amount.quantity);
        }
      }
    }

    // The inferred amount is the negation of the sum
    const inferredAmounts: string[] = [];
    for (const [commodity, balance] of balances.entries()) {
      const amount = -balance;
      inferredAmounts.push(this.formatAmount(amount, commodity, parsed));
    }

    // Find posting(s) without amounts and add hints
    const txLine = transaction.line ?? 0;
    let postingIndex = 0;

    for (const posting of transaction.postings) {
      if (!posting.amount) {
        const lineNum = txLine + 1 + postingIndex;  // +1 for header, then posting index
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        // Find end of account name
        const accountEnd = line.indexOf(posting.account) + posting.account.length;

        hints.push({
          position: Position.create(lineNum, accountEnd),
          label: `  ${inferredAmounts.join(', ')}`,
          kind: InlayHintKind.Parameter,
          paddingLeft: true
        });
      }
      postingIndex++;
    }

    return hints;
  }

  /**
   * Get hints for running balances after each posting
   */
  private getRunningBalanceHints(
    document: TextDocument,
    transaction: Transaction,
    parsed: ParsedDocument
  ): InlayHint[] {
    const hints: InlayHint[] = [];

    // Track running balances across all transactions
    // This would need to process ALL transactions up to this point
    // For now, we'll just show transaction-local balance changes

    const txLine = transaction.line ?? 0;
    let postingIndex = 0;

    for (const posting of transaction.postings) {
      if (posting.amount) {
        const lineNum = txLine + 1 + postingIndex;
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        // Find end of line (before comment if any)
        let endPos = line.length;
        const commentPos = line.search(/[;#]/);
        if (commentPos >= 0) {
          endPos = commentPos;
        }

        const formattedAmount = this.formatAmount(posting.amount.quantity, posting.amount.commodity || '', parsed);
        const balanceHint = `balance: ${formattedAmount}`;

        hints.push({
          position: Position.create(lineNum, endPos),
          label: ` (${balanceHint})`,
          kind: InlayHintKind.Type,
          paddingLeft: true
        });
      }
      postingIndex++;
    }

    return hints;
  }

  /**
   * Get hints for cost conversions
   */
  private getCostConversionHints(document: TextDocument, transaction: Transaction, parsed: ParsedDocument): InlayHint[] {
    const hints: InlayHint[] = [];

    const txLine = transaction.line ?? 0;
    let postingIndex = 0;

    for (const posting of transaction.postings) {
      if (posting.amount && posting.cost) {
        let totalCost: number;

        if (posting.cost.type === 'unit') {
          totalCost = posting.amount.quantity * posting.cost.amount.quantity;
        } else {
          totalCost = posting.cost.amount.quantity;
        }

        const lineNum = txLine + 1 + postingIndex;
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        // Find position after cost notation
        const costMatch = line.match(/@@?[^;#]*/);
        if (costMatch) {
          const costEnd = line.indexOf(costMatch[0]) + costMatch[0].length;

          const formattedCost = this.formatAmount(totalCost, posting.cost.amount.commodity || '', parsed);
          hints.push({
            position: Position.create(lineNum, costEnd),
            label: ` = ${formattedCost}`,
            kind: InlayHintKind.Type,
            paddingLeft: true
          });
        }
      }
      postingIndex++;
    }

    return hints;
  }
}

export const inlayHintsProvider = new InlayHintsProvider();
