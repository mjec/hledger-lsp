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
    const hints: InlayHint[] = [];
    const documentUri = URI.parse(document.uri).toString();

    // If showing running balances, we need to process all transactions to accumulate balances
    const runningBalances = config.showRunningBalances
      ? calculateRunningBalances(parsed)
      : new Map<number, Map<number, Map<string, number>>>();

    for (const transaction of parsed.transactions) {
      if (transaction.sourceUri?.toString() !== documentUri) {
        continue;
      }

      const txLine = transaction.line ?? 0;
      if (txLine < range.start.line || txLine > range.end.line) {
        continue;
      }

      // Use formatter to calculate ideal widths (Grid)
      // We pass the inlay hints config so the grid accounts for inferred items
      const widths = formattingProvider.calculateTransactionWidths(transaction, parsed, formattingOptions, config);

      let postingIndex = 0;
      for (const posting of transaction.postings) {
        const lineNum = txLine + 1 + postingIndex;
        // Get the current line content
        const line = document.getText({
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: Number.MAX_SAFE_INTEGER }
        });

        const accountEndIndex = line.indexOf(posting.account) + posting.account.length;

        // Find comment position
        const commentMatch = line.match(/[;#]/);
        const commentIndex = commentMatch ? commentMatch.index : -1;

        // Content "End" (before comment)
        const contentEndIndex = commentIndex !== -1 ? commentIndex : line.length;
        const contentBeforeComment = line.substring(0, contentEndIndex);
        const trimmedContent = contentBeforeComment.trimEnd();

        // Check if there is unexpected content after account
        // If the line is just "Account", trimmedContent length is accountEndIndex.
        // If the line is "Account  $10", trimmedContent is longer.
        // We only insert hints if we are "at the end" of the relevant explicit content.

        // 1. Inferred Amount
        if (config.showInferredAmounts && posting.amount && posting.amount.inferred) {
          // Check if we have explicit content blocking us (e.g. tags, or manually written stuff)
          // If the content after account is just whitespace, we are good.
          if (trimmedContent.length <= accountEndIndex) {
            const amountPreDecimalWidth = widths.amount.commodityBefore +
              widths.amount.spaceBetweenCommodityBeforeAndAmount +
              widths.amount.negPosSign +
              widths.amount.integerPart;

            const targetColumn = formattingOptions.decimalAlignColumn;
            // Calculate where the hint should visually start to align the decimal
            const hintStartColumn = targetColumn - amountPreDecimalWidth;

            // Current position is contentEndIndex.
            // We need padding to reach hintStartColumn.
            // Note: InlayHint padding is visual.
            const currentColumn = contentEndIndex!; // Assuming simple chars
            const paddingNeeded = Math.max(1, hintStartColumn - currentColumn); // At least 1 space

            const amountText = formatAmount(
              posting.amount.quantity,
              posting.amount.commodity,
              parsed,
              settings?.formatting
            );

            const labelPart: InlayHintLabelPart = {
              value: amountText,
              command: {
                title: 'Insert inferred amount',
                command: 'hledger.insertInferredAmount',
                arguments: [
                  document.uri,
                  lineNum,
                  contentEndIndex, // Insert at end of current content
                  posting.amount.quantity,
                  posting.amount.commodity
                ]
              }
            };

            hints.push({
              position: Position.create(lineNum, contentEndIndex!),
              label: [labelPart],
              kind: InlayHintKind.Parameter,
              paddingLeft: true, // Let VS Code handle standard padding? No, we want exact alignment.
              // If we use paddingLeft, it adds a standard space.
              // To do exact alignment, we might need to prepend spaces to the label value.
              // But user warned about VS Code truncating large padding.
              // Ideally, if the formatter ran, `currentColumn` matches `hintStartColumn`.
              // If not, we pad.
            });

            // Correct padding approach for alignment:
            // We can use `label` with leading spaces.
            const paddingString = ' '.repeat(paddingNeeded);
            // But wait, if we use `paddingLeft: true`, it adds roughly one space width?
            // We want exact column alignment.
            // Better to add spaces to the label value if we want strict alignment.
            // The user said: "if we pad the inlay hint itself then it has to be quite large... vscode seems to shorten is to ..."
            // This implies we should rely on the DOCUMENT having the whitespace (via formatter).
            // IF the document has whitespace, `paddingNeeded` will be small (0 or 1).
            // IF the document does not, we unfortunately have to pad the hint.

            // Let's modify the label to include the padding.
            labelPart.value = paddingString + amountText;

            // If we have a comment, we insert AT the comment position?
            // If we insert at `contentEndIndex`, and comment is at `commentIndex` (which equals contentEndIndex),
            // the hint appears before the comment.
            // This pushes the comment to the right. Correct.
          }
        }

        // 2. Inferred Cost
        // ... (similar logic, using widths.cost)
        if (config.showCostConversions && posting.cost && posting.cost.inferred) {
          // We can only show inferred cost if we are "past" the amount.
          // If amount was inferred, we effectively "added" it above.
          // But LSP Inlay Hints are independent.
          // If we have an inferred amount AND inferred cost, we need to stack them?
          // VS Code places hints at the same position in order.
          // So if we push Amount Hint, then Cost Hint, they appear: [Amount] [Cost].
          // We just need to calculate the Cost padding relative to the End of the Amount.

          // Where does the Amount end?
          // Amount End = TargetColumn (decimal align) + PostDecimalWidth.

          const amountPostDecimalWidth = widths.amount.decimalMark +
            widths.amount.decimalPart +
            widths.amount.spaceBetweenAmountAndCommodityAfter +
            widths.amount.commodityAfter;

          // The visual end of the amount block (whether explicit or inferred)
          const amountVisualEnd = formattingOptions.decimalAlignColumn + amountPostDecimalWidth;

          // Cost Start
          // We align Cost based on widths.cost?
          // Usually Cost keeps going.
          // Formatter logic: `line += renderAmountLayout(..., widths.cost)`
          // It just appends.
          // So we just need minimal padding from Amount End.

          // But if we are in "Inferred Amount" case, our "current physical position" is still `contentEndIndex`.
          // The Amount Hint adds virtual width.
          // We need to account for that.

          // This suggests we should calculate a "virtual cursor" position.
          // Start at `contentEndIndex`.
          // If Inferred Amount:
          //    Add padding + AmountText width to virtual cursor.
          // If Explicit Amount:
          //    Virtual cursor is at end of amount (which is `contentEndIndex`).

          // Let's implement this "Virtual Cursor" flow.
        }

        postingIndex++;
      }
    }
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
        const trimmedContent = line.substring(0, contentEndIndex).trimEnd();

        // Virtual cursor assumes we are starting from the end of the clean content
        // Use contentEndIndex (actual cursor) to account for existing whitespace
        let virtualColumn = contentEndIndex ?? 0;
        const insertPosition = Position.create(lineNum, contentEndIndex!);

        // 1. Amount
        if (posting.amount && !posting.amount.inferred) {
          // Explicit amount. Update virtual cursor to end of content.
          // (which is already done by init virtualColumn = trimmedContent.length)
        } else if (config.showInferredAmounts && posting.amount?.inferred) {
          // Only show if we don't have unexpected garbage
          // AND if we are not blocked by explicit items (Cost or Assertion)

          const hasExplicitCost = posting.cost && !posting.cost.inferred;
          const hasExplicitAssertion = posting.assertion;

          if (!hasExplicitCost && !hasExplicitAssertion) {
            const amountPreDecimalWidth = widths.amount.commodityBefore +
              widths.amount.spaceBetweenCommodityBeforeAndAmount +
              widths.amount.negPosSign +
              widths.amount.integerPart;

            const targetColumn = formattingOptions.decimalAlignColumn;
            const requiredPadding = Math.max(0, targetColumn - virtualColumn - amountPreDecimalWidth);

            const amountText = formatAmount(posting.amount.quantity, posting.amount.commodity, parsed, formattingOptions);

            const label = ' '.repeat(requiredPadding) + amountText;

            hints.push({
              position: insertPosition,
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
            });

            virtualColumn += label.length;
          }
        } else {
          // No amount (or blocked inferred).
          // We effectively skip the "Amount Block".
          // But for alignment of subsequent items, we might need to pad PAST the amount block?
          // See formatter logic:
          /*
          const postDecimalWidth = ...
          line += ' '.repeat(padding + preDecimalWidth + postDecimalWidth);
          */
          // If we have hidden amounts but show costs, we might need to pad.
          // But Inlay Hints are additive. We can't insert "just padding" easily without a label.
          // Unless we attach it to the next hint.
        }

        // 2. Cost
        if (posting.cost && !posting.cost.inferred) {
          // Explicit cost. Virtual cursor should logically be after this.
          // But wait, if explicit cost exists, it's in the text.
          // So virtualColumn (initially `trimmedContent.length`) ALREADY includes it.
          // We don't need to do anything.
        } else if (config.showCostConversions && posting.cost?.inferred) {
          // We want to add Cost Hint.

          // Check if blocked by explicit assertion
          const hasExplicitAssertion = posting.assertion;

          if (!hasExplicitAssertion) {
            const amountIsPresent = (posting.amount && !posting.amount.inferred) ||
              (config.showInferredAmounts && posting.amount?.inferred && !hasExplicitAssertion && !(posting.cost && !posting.cost.inferred));
            // Note: Logic for amountIsPresent is a bit circular if we re-check blocking logic.
            // Simplified: If virtualColumn has moved (meaning we added hint) OR we have explicit amount.
            // But virtualColumn update handles the Hint case.
            // Explicit Amount case? virtualColumn includes it.
            // So we just need to check if we are "at the start"?
            // Or just always pad?

            // If virtualColumn > trimmedContent.length, we added an Amount Hint.
            // If explicit Amount exists, trimmedContent.length includes it.

            // So we basically always want a space IF there is something before us.
            // If "Account" -> Inferred Amount -> " $10" -> Inferred Cost.
            // virtualColumn is at end of "$10". We want space.

            const padding = 1;

            const marker = (posting.cost.type === 'unit' ? '@' : '@@'); // Space handled by padding
            const costText = formatAmount(posting.cost.amount.quantity, posting.cost.amount.commodity, parsed, formattingOptions);

            const label = ' '.repeat(padding) + marker + ' ' + costText;

            hints.push({
              position: insertPosition,
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
            });
            virtualColumn += label.length;
          }
        }

        // 3. Running Balance (Assertion)
        if (config.showRunningBalances && !posting.assertion) {
          // Find running balance
          const txIndex = parsed.transactions.indexOf(transaction);
          const postingBalances = runningBalances.get(txIndex);
          const balanceMap = postingBalances?.get(postingIndex);

          if (balanceMap) {
            // Align assertion?
            // Currently formatter aligns assertions using `widths.assertion`.
            // But as noted in formatter.ts, running balances are dynamic width.
            // We can try to align to `widths.assertion` START if it exists?
            // Or just align to a fixed column?
            // Formatter says: `line += renderAmountLayout(layout, widths.assertion)` with `marker = ' = '`.

            // If we are appending to existing text/hints:
            // We want to reach `widths.assertion` start column?
            // Where does assertion start in the grid?
            // It starts after Cost block.
            // Cost block width = widths.cost....
            // We need to calculate cumulative width of grid?

            // Implementation Simplification:
            // Just add " = " + balances.
            // The user wants alignment.
            // If we have explicit assertions elsewhere, `widths.assertion` will be non-zero.
            // We can try to align the "=" to separate column?
            // That requires tracking the cumulative width of (Indent + Account + Amount + Cost).

            // Let's Calculate the Ideal Start Column for Assertion
            // Indent + Account + 2 spaces + AmountBlock + CostBlock
            // AmountBlock width = preDecimal + decimalMark + postDecimal...
            // Wait, `widths` just gives MAX widths of components.
            // Constructing the full offset:

            let idealStart = formattingOptions.indentation + widths.account + 2;

            // Amount Block Width
            const amountBlockWidth =
              widths.amount.commodityBefore +
              widths.amount.spaceBetweenCommodityBeforeAndAmount +
              widths.amount.negPosSign +
              widths.amount.integerPart +
              widths.amount.decimalMark +
              widths.amount.decimalPart +
              widths.amount.spaceBetweenAmountAndCommodityAfter +
              widths.amount.commodityAfter;

            // Correct logic: The Amount aligns at `decimalAlignColumn`.
            // So the Amount Block *ends* at `decimalAlignColumn` + `postDecimalPart`.

            const amountPostDecimal = widths.amount.decimalMark +
              widths.amount.decimalPart +
              widths.amount.spaceBetweenAmountAndCommodityAfter +
              widths.amount.commodityAfter;

            const amountEndColumn = formattingOptions.decimalAlignColumn + amountPostDecimal;

            // Cost Block
            // Cost is appended after Amount.
            // Does it strictly align? 
            // Formatter: `line += renderAmountLayout(layout, widths.cost)`
            // It renders the cost width.
            // Unlike Amount, Cost is not decimal-aligned to a global column in the simplified logic,
            // it just takes up `widths.cost` space.

            const costBlockWidth =
              widths.cost.marker + // " @ "
              widths.cost.commodityBefore +
              widths.cost.spaceBetweenCommodityBeforeAndAmount +
              widths.cost.negPosSign +
              widths.cost.integerPart +
              widths.cost.decimalMark +
              widths.cost.decimalPart +
              widths.cost.spaceBetweenAmountAndCommodityAfter +
              widths.cost.commodityAfter;

            const costEndColumn = amountEndColumn + costBlockWidth;

            // So Assertion should start at `costEndColumn`.

            const padding = Math.max(1, costEndColumn - virtualColumn);

            const balanceStrings: string[] = [];
            for (const [comm, amount] of balanceMap) {
              balanceStrings.push(formatAmount(amount, comm, parsed, formattingOptions));
            }
            const balanceText = balanceStrings.join(', ');

            const label = ' '.repeat(padding) + '= ' + balanceText;

            hints.push({
              position: insertPosition,
              label: [{
                value: label,
                command: {
                  title: 'Insert balance assertion',
                  command: 'hledger.insertBalanceAssertion',
                  arguments: [document.uri, lineNum, posting.account, balanceStrings]
                }
              }],
              kind: InlayHintKind.Type,
              paddingLeft: false
            });

          }
        }

        postingIndex++;
      }
    }
    return hints;
  }
}

export const inlayHintsProvider = new InlayHintsProvider();
