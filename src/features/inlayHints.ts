/**
 * Inlay hints provider for hledger language server
 *
 * Provides inline, non-intrusive information:
 * - Inferred amounts on postings without explicit amounts
 * - Running balances after each posting
 * - Cost conversions when costs are involved
 */

import { InlayHint, InlayHintKind, InlayHintLabelPart, Position, Range, Command } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Transaction, Posting } from '../types';
import { formatAmount } from '../utils/amountFormatter';
import { calculateTransactionBalance } from '../utils/balanceCalculator';
import { calculateRunningBalances, RunningBalanceMap } from '../utils/runningBalanceCalculator';


export interface InlayHintsSettings {
  /** Show inferred amounts on postings without explicit amounts */
  showInferredAmounts?: boolean;
  /** Show running balance after each posting */
  showRunningBalances?: boolean;
  /** Show cost conversions (e.g., "= $135") */
  showCostConversions?: boolean;
}

const DEFAULT_SETTINGS: Required<InlayHintsSettings> = {
  showInferredAmounts: false,
  showRunningBalances: false,
  showCostConversions: false
};

import { HledgerSettings } from '../server/settings';

export class InlayHintsProvider {
  /**
   * Provide inlay hints for a document
   */
  provideInlayHints(
    document: TextDocument,
    range: Range,
    parsed: ParsedDocument,
    settings?: HledgerSettings
  ): InlayHint[] {
    const config = { ...DEFAULT_SETTINGS, ...settings?.inlayHints };
    const hints: InlayHint[] = [];

    // If showing running balances, we need to process all transactions to accumulate balances
    // Otherwise, only process transactions within the requested range
    const runningBalances = config.showRunningBalances
      ? calculateRunningBalances(parsed)
      : new Map<number, Map<number, Map<string, number>>>();

    // Only process transactions within the requested range
    for (const transaction of parsed.transactions) {
      // Only show inlay hints for transactions in the current document
      // Normalize document URI to match internal storage format (decoded spaces, etc.)
      if (transaction.sourceUri?.toString() !== document.uri) {
        continue;
      }

      const txLine = transaction.line ?? 0;

      // Skip transactions outside the range
      if (txLine < range.start.line || txLine > range.end.line) {
        continue;
      }

      // Inferred amount hints
      if (config.showInferredAmounts) {
        hints.push(...this.getInferredAmountHints(document, transaction, parsed, settings));
      }

      // Running balance hints
      if (config.showRunningBalances) {
        hints.push(...this.getRunningBalanceHintsWithState(document, transaction, parsed, runningBalances, settings));
      }

      // Cost conversion hints
      if (config.showCostConversions) {
        hints.push(...this.getCostConversionHints(document, transaction, parsed, settings));
      }
    }

    return hints;
  }

  /**
   * Get hints for inferred amounts (postings with amounts marked as inferred)
   */
  private getInferredAmountHints(document: TextDocument, transaction: Transaction, parsed: ParsedDocument, settings?: HledgerSettings): InlayHint[] {
    const hints: InlayHint[] = [];

    const txLine = transaction.line ?? 0;
    let postingIndex = 0;

    for (const posting of transaction.postings) {
      // Show hint only for inferred amounts
      if (posting.amount && posting.amount.inferred) {
        const lineNum = txLine + 1 + postingIndex;  // +1 for header, then posting index
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        // Find end of account name
        const accountEnd = line.indexOf(posting.account) + posting.account.length;

        const amountText = formatAmount(
          posting.amount.quantity,
          posting.amount.commodity,
          parsed,
          settings?.formatting
        );

        // Create clickable label part with command to insert the amount
        const labelPart: InlayHintLabelPart = {
          value: `  ${amountText}`,
          command: {
            title: 'Insert inferred amount',
            command: 'hledger.insertInferredAmount',
            arguments: [
              document.uri,
              lineNum,
              posting.account,
              amountText
            ]
          }
        };

        hints.push({
          position: Position.create(lineNum, accountEnd),
          label: [labelPart],
          kind: InlayHintKind.Parameter,
          paddingLeft: true,
          tooltip: 'Click to insert this inferred amount into the document'
        });
      }
      postingIndex++;
    }

    return hints;
  }

  /**
   * Get hints for running balances after each posting (with pre-calculated state)
   */
  private getRunningBalanceHintsWithState(
    document: TextDocument,
    transaction: Transaction,
    parsed: ParsedDocument,
    runningBalances: Map<number, Map<number, Map<string, number>>>,
    settings?: HledgerSettings
  ): InlayHint[] {
    const hints: InlayHint[] = [];

    // Find transaction index
    const txIndex = parsed.transactions.indexOf(transaction);
    if (txIndex === -1) {
      return hints;
    }

    const postingBalances = runningBalances.get(txIndex);
    if (!postingBalances) {
      return hints;
    }

    const txLine = transaction.line ?? 0;

    for (let postingIndex = 0; postingIndex < transaction.postings.length; postingIndex++) {
      const posting = transaction.postings[postingIndex];
      const balanceMap = postingBalances.get(postingIndex);

      // Don't show running balance hint if posting already has a balance assertion
      // Show hint for both explicit and inferred amounts
      if (balanceMap && !posting.assertion) {
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

        // Format all commodity balances for this posting
        const balanceHints: string[] = [];
        for (const [commodity, balance] of balanceMap.entries()) {
          const formattedBalance = formatAmount(balance, commodity, parsed, settings?.formatting);
          balanceHints.push(formattedBalance);
        }

        const balanceText = balanceHints.join(', ');

        // Create clickable label part with command to insert balance assertion
        // Format as actual balance assertion syntax: " = $amount"
        const labelPart: InlayHintLabelPart = {
          value: ` = ${balanceText} `,
          command: {
            title: 'Insert balance assertion',
            command: 'hledger.insertBalanceAssertion',
            arguments: [
              document.uri,
              lineNum,
              posting.account,
              balanceHints
            ]
          }
        };

        hints.push({
          position: Position.create(lineNum, endPos),
          label: [labelPart],
          kind: InlayHintKind.Type,
          paddingLeft: true,
          tooltip: `Click to insert balance assertion for ${posting.account}`
        });
      }
    }

    return hints;
  }

  /**
   * Get hints for cost conversions
   */
  private getCostConversionHints(document: TextDocument, transaction: Transaction, parsed: ParsedDocument, settings?: HledgerSettings): InlayHint[] {
    const hints: InlayHint[] = [];

    const txLine = transaction.line ?? 0;
    let postingIndex = 0;

    for (const posting of transaction.postings) {
      // Only show cost conversion hints for unit cost (@), not total cost (@@)
      // since total cost is already explicit
      if (posting.amount && posting.cost && posting.cost.type === 'unit') {
        const totalCost = posting.amount.quantity * posting.cost.amount.quantity;

        const lineNum = txLine + 1 + postingIndex;
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        // Find position after cost notation
        const costMatch = line.match(/@@?[^;#]*/);
        if (costMatch) {
          const costEnd = line.indexOf(costMatch[0]) + costMatch[0].length;

          const formattedCost = formatAmount(totalCost, posting.cost.amount.commodity || '', parsed);

          // For unit cost (@), show total cost equivalent (@@ notation)
          const labelPart: InlayHintLabelPart = {
            value: ` @@${formattedCost} `,
            command: {
              title: 'Convert to total cost',
              command: 'hledger.convertToTotalCost',
              arguments: [
                document.uri,
                lineNum,
                posting.account,
                formattedCost
              ]
            }
          };

          hints.push({
            position: Position.create(lineNum, costEnd),
            label: [labelPart],
            kind: InlayHintKind.Type,
            paddingLeft: true,
            tooltip: 'Click to convert unit cost (@) to total cost (@@)'
          });
        }
      }
      postingIndex++;
    }

    return hints;
  }
}

export const inlayHintsProvider = new InlayHintsProvider();
