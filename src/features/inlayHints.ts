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
import { URI } from 'vscode-uri';
import { ParsedDocument } from '../types';
import { formatAmount } from '../utils/amountFormatter';
import { calculateRunningBalances, RunningBalanceMap } from '../utils/runningBalanceCalculator';
import {
  DEFAULT_FORMATTING_OPTIONS,
  DEFAULT_INLAY_HINTS_OPTIONS,
  type FormattingOptions,
  type InlayHintsOptions,
  type HledgerSettings
} from '../server/settings';
import { formattingProvider } from './formatter';

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
    const formattingOptions = { ...DEFAULT_FORMATTING_OPTIONS, ...settings?.formatting };
    const emptyRunninBalanceMap: RunningBalanceMap = new Map<number, Map<number, Map<string, number>>>();

    // If showing running balances, we need to process all transactions to accumulate balances
    const runningBalances = config.showRunningBalances
      ? calculateRunningBalances(parsed)
      : emptyRunninBalanceMap;

    return this.processTransactions(parsed, document, range, config, formattingOptions, runningBalances);
  }

  private processTransactions(
    parsed: ParsedDocument,
    document: TextDocument,
    range: Range,
    config: InlayHintsOptions,
    formattingOptions: FormattingOptions,
    runningBalances: Map<number, Map<number, Map<string, number>>>
  ): InlayHint[] {
    const hints: InlayHint[] = [];
    const documentUri = URI.parse(document.uri).toString();

    for (const transaction of parsed.transactions) {
      if (transaction.sourceUri?.toString() !== documentUri) continue;
      const txLine = transaction.line ?? 0;
      if (txLine < range.start.line || txLine > range.end.line) continue;

      const widths = formattingProvider.calculateTransactionWidths(transaction, parsed, formattingOptions, config);

      let postingIndex = 0;
      for (const posting of transaction.postings) {
        const lineNum = txLine + 1 + postingIndex;
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        const commentMatch = line.match(/[;#]/);
        const commentIndex = commentMatch ? commentMatch.index : -1;
        const contentEndIndex = commentIndex !== -1 ? commentIndex : line.length;

        // Virtual cursor tracks the visual column position as we append hints
        let virtualColumn = contentEndIndex ?? 0;

        // 1. Amount
        if (posting.amount && !posting.amount.inferred) {
          // Explicit amount. Virtual cursor is already at the end of content.
        } else if (config.showInferredAmounts && posting.amount?.inferred) {
          const hint = this.getInferredAmountHint(
            document,
            posting,
            lineNum,
            contentEndIndex!,
            virtualColumn,
            widths,
            formattingOptions,
            parsed
          );
          if (hint) {
            hints.push(hint);
            virtualColumn += typeof hint.label === 'string' ? hint.label.length : hint.label[0].value.length;
          }
        }

        // 2. Cost
        if (posting.cost && !posting.cost.inferred) {
          // Explicit cost. Virtual cursor included in contentEndIndex.
        } else if (config.showCostConversions && posting.cost?.inferred) {
          const hint = this.getInferredCostHint(
            document,
            posting,
            lineNum,
            contentEndIndex!,
            formattingOptions,
            parsed
          );
          if (hint) {
            hints.push(hint);
            virtualColumn += typeof hint.label === 'string' ? hint.label.length : hint.label[0].value.length;
          }
        }

        // 3. Running Balance (Assertion)
        if (config.showRunningBalances && !posting.assertion) {
          const hint = this.getBalanceAssertionHint(
            document,
            lineNum,
            contentEndIndex!,
            virtualColumn,
            transaction,
            postingIndex,
            parsed,
            runningBalances,
            widths,
            formattingOptions
          );
          if (hint) {
            hints.push(hint);
          }
        }

        postingIndex++;
      }
    }
    return hints;
  }

  private getInferredAmountHint(
    document: TextDocument,
    posting: any,
    lineNum: number,
    contentEndIndex: number,
    virtualColumn: number,
    widths: any,
    formattingOptions: FormattingOptions,
    parsed: ParsedDocument
  ): InlayHint | null {
    const hasExplicitCost = posting.cost && !posting.cost.inferred;
    const hasExplicitAssertion = posting.assertion;

    if (hasExplicitCost || hasExplicitAssertion) {
      return null;
    }

    const amountPreDecimalWidth = widths.amount.commodityBefore +
      widths.amount.spaceBetweenCommodityBeforeAndAmount +
      widths.amount.negPosSign +
      widths.amount.integerPart;

    const targetColumn = formattingOptions.decimalAlignColumn;
    const requiredPadding = Math.max(0, targetColumn - virtualColumn - amountPreDecimalWidth);

    const amountText = formatAmount(posting.amount.quantity, posting.amount.commodity, parsed, formattingOptions);
    const label = ' '.repeat(requiredPadding) + amountText;

    return {
      position: Position.create(lineNum, contentEndIndex),
      label: [{
        value: label,
        command: {
          title: 'Insert inferred amount',
          command: 'hledger.insertInferredAmount',
          arguments: [document.uri, lineNum, contentEndIndex, posting.amount.quantity, posting.amount.commodity]
        }
      }],
      kind: InlayHintKind.Parameter,
      paddingLeft: false
    };
  }

  private getInferredCostHint(
    document: TextDocument,
    posting: any,
    lineNum: number,
    contentEndIndex: number,
    formattingOptions: FormattingOptions,
    parsed: ParsedDocument
  ): InlayHint | null {
    const hasExplicitAssertion = posting.assertion;
    if (hasExplicitAssertion) {
      return null;
    }

    // Always pad with at least one space if we are appending to something
    const padding = 1;
    const marker = (posting.cost.type === 'unit' ? '@' : '@@');
    const costText = formatAmount(posting.cost.amount.quantity, posting.cost.amount.commodity, parsed, formattingOptions);
    const label = ' '.repeat(padding) + marker + ' ' + costText;

    return {
      position: Position.create(lineNum, contentEndIndex),
      label: [{
        value: label,
        command: {
          title: 'Insert cost',
          command: 'hledger.insertCost',
          arguments: [document.uri, lineNum, contentEndIndex, posting.cost.amount.quantity, posting.cost.amount.commodity]
        }
      }],
      kind: InlayHintKind.Parameter,
      paddingLeft: false
    };
  }

  private getBalanceAssertionHint(
    document: TextDocument,
    lineNum: number,
    contentEndIndex: number,
    virtualColumn: number,
    transaction: any,
    postingIndex: number,
    parsed: ParsedDocument,
    runningBalances: Map<number, Map<number, Map<string, number>>>,
    widths: any,
    formattingOptions: FormattingOptions
  ): InlayHint | null {
    const txIndex = parsed.transactions.indexOf(transaction);
    const postingBalances = runningBalances.get(txIndex);
    const balanceMap = postingBalances?.get(postingIndex);

    if (!balanceMap) {
      return null;
    }

    // Calculate alignment
    const amountPostDecimal = widths.amount.decimalMark +
      widths.amount.decimalPart +
      widths.amount.spaceBetweenAmountAndCommodityAfter +
      widths.amount.commodityAfter;

    const amountEndColumn = formattingOptions.decimalAlignColumn + amountPostDecimal;

    const costBlockWidth =
      widths.cost.marker +
      widths.cost.commodityBefore +
      widths.cost.spaceBetweenCommodityBeforeAndAmount +
      widths.cost.negPosSign +
      widths.cost.integerPart +
      widths.cost.decimalMark +
      widths.cost.decimalPart +
      widths.cost.spaceBetweenAmountAndCommodityAfter +
      widths.cost.commodityAfter;

    const costEndColumn = amountEndColumn + costBlockWidth;
    const padding = Math.max(1, costEndColumn - virtualColumn);

    const balanceStrings: string[] = [];
    for (const [comm, amount] of balanceMap) {
      balanceStrings.push(formatAmount(amount, comm, parsed, formattingOptions));
    }
    const balanceText = balanceStrings.join(', ');
    const label = ' '.repeat(padding) + '= ' + balanceText;

    return {
      position: Position.create(lineNum, contentEndIndex),
      label: [{
        value: label,
        command: {
          title: 'Insert balance assertion',
          command: 'hledger.insertBalanceAssertion',
          arguments: [document.uri, lineNum, balanceStrings]
        }
      }],
      kind: InlayHintKind.Type,
      paddingLeft: false
    };
  }
}

export const inlayHintsProvider = new InlayHintsProvider();
