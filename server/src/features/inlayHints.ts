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
import { toFilePath, toFileUri } from '../utils/uri';

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

export class InlayHintsProvider {
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

    // If showing running balances, we need to process all transactions to accumulate balances
    // Otherwise, only process transactions within the requested range
    const runningBalances = config.showRunningBalances
      ? this.calculateRunningBalances(parsed)
      : new Map<number, Map<number, Map<string, number>>>();

    // Only process transactions within the requested range
    for (const transaction of parsed.transactions) {
      // Only show inlay hints for transactions in the current document
      // Normalize document URI to match internal storage format (decoded spaces, etc.)
      const normalizedDocUri = toFileUri(toFilePath(document.uri));
      if (transaction.sourceUri !== normalizedDocUri) {
        continue;
      }

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
        hints.push(...this.getRunningBalanceHintsWithState(document, transaction, parsed, runningBalances));
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
    const balances = calculateTransactionBalance(transaction);

    // The inferred amount is the negation of the sum
    const inferredAmounts: string[] = [];
    for (const [commodity, balance] of balances.entries()) {
      const amount = -balance;
      inferredAmounts.push(formatAmount(amount, commodity, parsed));
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

        const amountText = inferredAmounts.join(', ');

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
   * Calculate inferred amounts for a transaction
   * Returns a map of posting index to inferred amounts (commodity -> quantity)
   */
  private calculateInferredAmounts(transaction: Transaction): Map<number, Map<string, number>> {
    const result = new Map<number, Map<string, number>>();

    // Calculate balance per commodity from explicit amounts
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
    const inferredAmounts = new Map<string, number>();
    for (const [commodity, balance] of balances.entries()) {
      inferredAmounts.set(commodity, -balance);
    }

    // Assign inferred amounts to postings without explicit amounts
    for (let i = 0; i < transaction.postings.length; i++) {
      if (!transaction.postings[i].amount) {
        result.set(i, new Map(inferredAmounts));
      }
    }

    return result;
  }

  /**
   * Calculate running balances for all transactions
   * Returns a map of transaction->posting index->account->commodity->balance
   */
  private calculateRunningBalances(parsed: ParsedDocument): Map<number, Map<number, Map<string, number>>> {
    const result = new Map<number, Map<number, Map<string, number>>>();

    // Track global account balances across all transactions
    const accountBalances = new Map<string, Map<string, number>>();

    // Sort transactions by date to calculate balances in chronological order
    // This is important when transactions come from multiple files via includes
    const sortedTransactions = [...parsed.transactions].sort((a, b) => {
      return a.date.localeCompare(b.date);
    });

    // Create a map from sorted index to original index
    const sortedToOriginalIndex = new Map<number, number>();
    sortedTransactions.forEach((tx, sortedIdx) => {
      const originalIdx = parsed.transactions.indexOf(tx);
      sortedToOriginalIndex.set(sortedIdx, originalIdx);
    });

    for (let sortedIdx = 0; sortedIdx < sortedTransactions.length; sortedIdx++) {
      const transaction = sortedTransactions[sortedIdx];
      const txIndex = sortedToOriginalIndex.get(sortedIdx)!;
      const postingBalances = new Map<number, Map<string, number>>();

      // Calculate inferred amounts for this transaction
      const inferredAmounts = this.calculateInferredAmounts(transaction);

      for (let postingIndex = 0; postingIndex < transaction.postings.length; postingIndex++) {
        const posting = transaction.postings[postingIndex];
        const account = posting.account;

        // Get amount (either explicit or inferred)
        let amountMap: Map<string, number> | undefined;

        if (posting.amount) {
          // Explicit amount
          const commodity = posting.amount.commodity || '';
          amountMap = new Map([[commodity, posting.amount.quantity]]);
        } else {
          // Inferred amount
          amountMap = inferredAmounts.get(postingIndex);
        }

        if (amountMap) {
          // Update balance for each commodity in this posting
          for (const [commodity, quantity] of amountMap.entries()) {
            // Get or create account balance map
            if (!accountBalances.has(account)) {
              accountBalances.set(account, new Map<string, number>());
            }
            const commodityBalances = accountBalances.get(account)!;

            // Update balance
            const currentBalance = commodityBalances.get(commodity) || 0;
            const newBalance = currentBalance + quantity;
            commodityBalances.set(commodity, newBalance);

            // Store this posting's resulting balance
            if (!postingBalances.has(postingIndex)) {
              postingBalances.set(postingIndex, new Map());
            }
            postingBalances.get(postingIndex)!.set(commodity, newBalance);
          }
        }
      }

      result.set(txIndex, postingBalances);
    }

    return result;
  }

  /**
   * Get hints for running balances after each posting (with pre-calculated state)
   */
  private getRunningBalanceHintsWithState(
    document: TextDocument,
    transaction: Transaction,
    parsed: ParsedDocument,
    runningBalances: Map<number, Map<number, Map<string, number>>>
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
          const formattedBalance = formatAmount(balance, commodity, parsed);
          balanceHints.push(formattedBalance);
        }

        const balanceText = balanceHints.join(', ');

        // Create clickable label part with command to insert balance assertion
        // Format as actual balance assertion syntax: " = $amount"
        const labelPart: InlayHintLabelPart = {
          value: ` = ${balanceText}`,
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
  private getCostConversionHints(document: TextDocument, transaction: Transaction, parsed: ParsedDocument): InlayHint[] {
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
            value: ` @@ ${formattedCost}`,
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
