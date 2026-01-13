/**
 * Code lens provider for hledger language server
 *
 * Provides clickable inline information:
 * - Transaction counts for accounts
 *
 * Note: Running balances are handled by inlay hints, which is a more natural
 * place for position-sensitive information.
 */

import { CodeLens, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { ParsedDocument } from '../types';
import { DEFAULT_CODE_LENS_OPTIONS, type CodeLensOptions } from '../server/settings';

export class CodeLensProvider {
  /**
   * Calculate transaction counts per account up to each transaction
   * Returns a map of transaction index -> account -> count up to that transaction
   */
  private calculateTransactionCounts(parsed: ParsedDocument): Map<number, Map<string, number>> {
    const result = new Map<number, Map<string, number>>();
    const globalCounts = new Map<string, number>();

    // Sort transactions by date to count in chronological order
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
      const accountsInTransaction = new Set<string>();

      // Count each account once per transaction
      for (const posting of transaction.postings) {
        accountsInTransaction.add(posting.account);
      }

      // Increment count for each unique account in this transaction
      for (const account of accountsInTransaction) {
        globalCounts.set(account, (globalCounts.get(account) || 0) + 1);
      }

      // Store snapshot of counts for this transaction
      result.set(txIndex, new Map(globalCounts));
    }

    return result;
  }

  /**
   * Provide code lenses for a document
   */
  provideCodeLenses(
    document: TextDocument,
    parsed: ParsedDocument,
    settings?: Partial<CodeLensOptions>
  ): CodeLens[] {
    const config = { ...DEFAULT_CODE_LENS_OPTIONS, ...settings };
    const lenses: CodeLens[] = [];
    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

    // If transaction counts are not enabled, return early
    if (!config.showTransactionCounts) {
      return lenses;
    }

    // Calculate transaction counts
    const transactionCounts = this.calculateTransactionCounts(parsed);

    // Add code lenses for each transaction
    for (let txIndex = 0; txIndex < parsed.transactions.length; txIndex++) {
      const transaction = parsed.transactions[txIndex];

      // Only show code lenses for transactions in the current document
      if (transaction.sourceUri?.toString() !== documentUri) {
        continue;
      }

      const txLine = transaction.line ?? 0;

      // Transaction count code lens
      const countsAtTx = transactionCounts.get(txIndex);

      if (countsAtTx) {
        // Show counts for accounts in this transaction
        const accountsInTx = new Set<string>();
        for (const posting of transaction.postings) {
          accountsInTx.add(posting.account);
        }

        const countTexts: string[] = [];
        for (const account of accountsInTx) {
          const count = countsAtTx.get(account) || 0;
          countTexts.push(`${account}: ${count} tx`);
        }

        if (countTexts.length > 0) {
          // Code lens - display only (command field is optional and unused)
          lenses.push({
            range: Range.create(
              Position.create(txLine, 0),
              Position.create(txLine, 0)
            ),
            command: {
              title: `📊 ${countTexts.join(' | ')}`,
              command: ''  // Empty command means display-only
            }
          });
        }
      }
    }

    return lenses;
  }
}

export const codeLensProvider = new CodeLensProvider();
