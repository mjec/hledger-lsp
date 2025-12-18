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
import { URI } from 'vscode-uri';
import { ParsedDocument, Transaction, Posting, Amount } from '../types';
import { formatAmount, getAmountLayout } from '../utils/amountFormatter';
import { calculateTransactionBalance } from '../utils/balanceCalculator';
import { calculateRunningBalances, RunningBalanceMap } from '../utils/runningBalanceCalculator';
import {
  DEFAULT_FORMATTING_OPTIONS,
  DEFAULT_INLAY_HINTS_OPTIONS,
  type FormattingOptions,
  type InlayHintsOptions,
  type HledgerSettings
} from '../server/settings';

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
    const config = { ...DEFAULT_INLAY_HINTS_OPTIONS, ...settings?.inlayHints };
    const hints: InlayHint[] = [];
    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

    // If showing running balances, we need to process all transactions to accumulate balances
    // Otherwise, only process transactions within the requested range
    const runningBalances = config.showRunningBalances
      ? calculateRunningBalances(parsed)
      : new Map<number, Map<number, Map<string, number>>>();

    // Only process transactions within the requested range
    for (const transaction of parsed.transactions) {
      // Only show inlay hints for transactions in the current document
      if (transaction.sourceUri?.toString() !== documentUri) {
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
   * Calculate insertion position for inferred amount hint
   */
  private calculateInferredAmountHintInsertionPosition(
    line: string,
    accountEnd: number,
    amount: Amount,
    parsed: ParsedDocument,
    settings?: HledgerSettings
  ): number {
    const options: FormattingOptions = {
      ...DEFAULT_FORMATTING_OPTIONS,
      ...settings?.formatting
    };

    // Get amount layout to determine pre-decimal width
    const layout = getAmountLayout(amount, parsed, options);
    const preDecimalWidth =
      layout.commodityBefore.length +
      (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore ? 1 : 0) +
      (layout.isNegative ? 1 : 0) +
      layout.amountIntegerString.length;

    // Calculate the target position for the start of the amount (before the decimal)
    const targetColumn = Math.max(options.decimalAlignColumn, accountEnd + options.minSpacing + preDecimalWidth);
    const amountStartColumn = targetColumn - preDecimalWidth;

    return amountStartColumn

  }

  /**
 * Calculate insertion position for Running Balance assertion hint
 */
  private calculateAssertionHintInsertionPosition(
    line: string,
    accountEnd: number,
    amount: Amount,
    parsed: ParsedDocument,
    settings?: HledgerSettings
  ): number {
    const options: FormattingOptions = {
      ...DEFAULT_FORMATTING_OPTIONS,
      ...settings?.formatting
    };

    // TODO implement proper calculation for assertion hint position

    return options.decimalAlignColumn + 4; // +3 for ".00"

  }

  /**
 * Calculate insertion position for Cost assertion hint
 */
  private calculateCostHintInsertionPosition(
    line: string,
    accountEnd: number,
    amount: Amount,
    parsed: ParsedDocument,
    settings?: HledgerSettings
  ): number {
    const options: FormattingOptions = {
      ...DEFAULT_FORMATTING_OPTIONS,
      ...settings?.formatting
    };

    // TODO implement proper calculation for assertion hint position

    return options.decimalAlignColumn + 3;

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

        // Check if non-whitespace content exists after account (before comment)
        const afterAccount = line.substring(accountEnd);
        const commentPos = afterAccount.search(/[;#]/);
        const beforeComment = commentPos >= 0
          ? afterAccount.substring(0, commentPos)
          : afterAccount;

        const hasContentAfterAccount = beforeComment.trim().length > 0;

        // Skip hint if non-whitespace, non-comment content exists after account
        // This prevents hints from appearing when amounts, costs, or assertions are present
        if (hasContentAfterAccount) {
          postingIndex++;
          continue;
        }

        // Calculate alignment padding and insertion position
        const insertPosition = this.calculateInferredAmountHintInsertionPosition(
          line,
          accountEnd,
          posting.amount,
          parsed,
          settings
        );



        // Format amount without extra padding (padding handled separately)
        const amountText = formatAmount(
          posting.amount.quantity,
          posting.amount.commodity,
          parsed,
          settings?.formatting
        );

        // Create clickable label part with command to insert the amount
        const labelPart: InlayHintLabelPart = {
          value: `${amountText}`,
          command: {
            title: 'Insert inferred amount',
            command: 'hledger.insertInferredAmount',
            arguments: [
              document.uri,
              lineNum,
              accountEnd,
              posting.amount.quantity,
              posting.amount.commodity
            ]
          }
        };

        hints.push({
          position: Position.create(lineNum, insertPosition),
          label: [labelPart],
          kind: InlayHintKind.Parameter,
          paddingLeft: false,  // We handle padding ourselves
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

        // Find end of non-whitespace content (before comment)
        const commentPos = line.search(/[;#]/);
        const beforeComment = commentPos >= 0
          ? line.substring(0, commentPos)
          : line;

        const trimmedLine = beforeComment.trimEnd();
        const contentEnd = trimmedLine.length;

        // Check if there's only whitespace between content end and a reasonable position
        const afterContent = beforeComment.substring(contentEnd);
        const hasOnlyWhitespace = afterContent.trim().length === 0;

        const insertPosition = this.calculateAssertionHintInsertionPosition(
          line,
          contentEnd,
          posting.amount!,
          parsed,
          settings
        );
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
          position: Position.create(lineNum, insertPosition),
          label: [labelPart],
          kind: InlayHintKind.Type,
          paddingLeft: false,  // No LSP padding
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
      // Show hint only for postings inferred costs
      if (posting.cost && posting.cost.inferred) {

        const lineNum = txLine + 1 + postingIndex;
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        // Find end of account name
        const accountEnd = line.indexOf(posting.account) + posting.account.length;

        const insertPosition = this.calculateCostHintInsertionPosition(
          line,
          accountEnd,
          posting.cost.amount,
          parsed,
          settings
        );



        // Format amount without extra padding (padding handled separately)
        const amountText = formatAmount(
          posting.cost.amount.quantity,
          posting.cost.amount.commodity,
          parsed,
          settings?.formatting
        );

        // Create clickable label part with command to insert the amount
        const labelPart: InlayHintLabelPart = {
          value: ` @@ ${amountText}`,
          command: {
            title: 'Insert inferred cost',
            command: 'hledger.insertCost',
            arguments: [
              document.uri,
              lineNum,
              accountEnd,
              posting.cost.amount.quantity,
              posting.cost.amount.commodity
            ]
          }
        };

        hints.push({
          position: Position.create(lineNum, insertPosition),
          label: [labelPart],
          kind: InlayHintKind.Parameter,
          paddingLeft: false,  // We handle padding ourselves
          tooltip: 'Click to insert this inferred cost into the document'
        });


      }
      postingIndex++;
    }

    return hints;
  }
}

export const inlayHintsProvider = new InlayHintsProvider();
