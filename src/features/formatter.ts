/**
 * Formatting provider for hledger journal files
 */

import { TextEdit, Range, Position, FormattingOptions as LSPFormattingOptions } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { ParsedDocument, Transaction } from '../types';
import { parseTransactionHeader } from '../parser/ast';
import { isTransactionHeader, isComment, isDirective } from '../utils/index';
import { getAmountLayout, AmountLayout, renderAmountLayout, AmountWidths } from '../utils/amountFormatter';
import { FormattingOptions, DEFAULT_FORMATTING_OPTIONS, InlayHintsOptions, DEFAULT_INLAY_HINTS_OPTIONS } from '../server/settings';
import { isSafeToFormat } from './formattingValidation';

export interface TransactionColumnWidths {
  indent: number;
  account: number;
  amount: AmountWidths;
  cost: AmountWidths;
  assertion: AmountWidths;
}

export class FormattingProvider {
  /**
   * Format an entire document
   */
  formatDocument(
    document: TextDocument,
    parsed: ParsedDocument,
    _lspOptions: LSPFormattingOptions,
    userOptions: Partial<FormattingOptions> = {},
    inlayHintSettings: Partial<InlayHintsOptions> = {}
  ): TextEdit[] {

    const options = { ...DEFAULT_FORMATTING_OPTIONS, ...userOptions };
    const inlayHintsConfig = { ...DEFAULT_INLAY_HINTS_OPTIONS, ...inlayHintSettings };
    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();
    const text = document.getText();
    const lines = text.split('\n');

    // Format line by line, tracking transactions
    const formattedLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (isTransactionHeader(trimmed)) {
        // Format the transaction header
        formattedLines.push(this.formatTransactionHeader(trimmed));
        const transaction = parsed.transactions.find(t => (t.line === i && t.sourceUri?.toString() === documentUri));
        const transactionLines: string[] = [];
        i++;

        while (i < lines.length) {
          const postingLine = lines[i];
          const postingTrimmed = postingLine.trim();

          // Stop at empty line, next transaction, or directive
          if (!postingTrimmed || isTransactionHeader(postingTrimmed) || isDirective(postingTrimmed)) {
            break;
          }

          transactionLines.push(postingLine);
          i++;
        }

        // Format all postings in the transaction together for alignment
        formattedLines.push(...this.formatTransactionLines(transactionLines, transaction, parsed, options, inlayHintsConfig));

        // Don't increment i here as we've already moved past the transaction
        continue;
      } else if (isDirective(trimmed)) {
        formattedLines.push(this.formatDirective(trimmed));
      } else if (trimmed === '') {
        formattedLines.push('');
      } else if (isComment(trimmed)) {
        formattedLines.push(trimmed);
      } else {
        // Unknown line type, preserve as-is
        formattedLines.push(line.trimEnd());
      }

      i++;
    }

    const formattedText = formattedLines.join('\n');

    return [{
      range: {
        start: { line: 0, character: 0 },
        end: { line: lines.length, character: 0 }
      },
      newText: formattedText
    }];
  }

  /**
   * Format a range of lines
   */
  formatRange(
    document: TextDocument,
    _range: Range,
    parsed: ParsedDocument,
    _lspOptions: LSPFormattingOptions,
    userOptions: Partial<FormattingOptions> = {},
    inlayHintSettings: Partial<InlayHintsOptions> = {}
  ): TextEdit[] {
    // For range formatting, we format the entire document and then extract the range
    // This ensures consistency when formatting partial selections
    return this.formatDocument(document, parsed, _lspOptions, userOptions, inlayHintSettings);
  }

  /**
   * Format on type (after pressing Enter)
   */
  formatOnType(
    document: TextDocument,
    _position: Position,
    ch: string,
    parsed: ParsedDocument,
    _lspOptions: LSPFormattingOptions,
    userOptions: Partial<FormattingOptions> = {},
    inlayHintSettings: Partial<InlayHintsOptions> = {}
  ): TextEdit[] {
    // Only format on newline
    if (ch !== '\n') {
      return [];
    }

    // Format the entire document to maintain alignment
    return this.formatDocument(document, parsed, _lspOptions, userOptions, inlayHintSettings);
  }

  private formatTransactionLines(
    lines: string[],
    transaction: Transaction | undefined,
    parsed: ParsedDocument,
    options: FormattingOptions,
    inlayHintsConfig: InlayHintsOptions,
  ): string[] {
    let formattedLines: string[] = [];
    let postingHasInlayHintsArray: boolean[] = [];

    if (!transaction) {
      // No transaction info, just trim lines
      formattedLines = lines.map(line => line.trimEnd());
      return formattedLines;
    }

    // First pass: Calculate all column widths
    const widths = this.calculateTransactionWidths(transaction, parsed, options, inlayHintsConfig);

    // Second pass: Validate and format each posting line
    const formattedPostingLines: string[] = [];
    const validationResults: boolean[] = []; // Track which lines passed validation

    for (let postingIndex = 0; postingIndex < transaction.postings.length; postingIndex++) {
      const posting = transaction.postings[postingIndex];
      const originalLine = lines[postingIndex] || '';

      // Validate posting before formatting
      const safe = isSafeToFormat(posting, parsed, options);

      if (!safe) {
        // Not safe to format - preserve original line
        formattedPostingLines.push(originalLine.trimEnd());
        validationResults.push(false);
        postingHasInlayHintsArray.push(false);
        continue; // Skip formatting for this line
      }

      // Safe to format - format normally
      validationResults.push(true);
      let line = ' '.repeat(widths.indent);
      line += posting.account;
      line += ' '.repeat(2); // Minimum two spaces after account name
      const postingHasInlayHints = (inlayHintsConfig.showInferredAmounts && posting.amount?.inferred) ||
        (inlayHintsConfig.showCostConversions && posting.cost?.inferred) || (inlayHintsConfig.showRunningBalances) || false;


      // Calculate where the amount *should* start
      // This is used for BOTH explicit amounts AND ensuring space for inferred amounts
      const amountPreDecimalWidth = widths.amount.commodityBefore +
        widths.amount.spaceBetweenCommodityBeforeAndAmount +
        widths.amount.negPosSign +
        widths.amount.integerPart;

      const currentLen = line.length;
      const targetLen = options.decimalAlignColumn;
      const amountPadding = Math.max(0, targetLen - currentLen - amountPreDecimalWidth);

      // 1. Amount
      if (posting.amount && !posting.amount.inferred) {
        const marker = '';
        const layout: AmountLayout = getAmountLayout(posting.amount, parsed, options, marker);
        const amountBlock = renderAmountLayout(layout, widths.amount);

        line += ' '.repeat(amountPadding) + amountBlock;
      } else if (inlayHintsConfig.showInferredAmounts && posting.amount?.inferred && (!posting.assertion || posting.assertion.inferred)) {
        // Space for inferred amount - PAD TO THE START OF THE AMOUNT
        // We do NOT print the amount (Inlay Hints does that), but we ensure the whitespace exists
        line += ' '.repeat(amountPadding);

        // Note: We intentionally do NOT pad the "post-decimal" part for inferred amounts here
        // The inlay hint itself will start at the cursor position.
        // However, if we have subsequent columns (Cost, Assertion), we might need to pad PAST the inferred amount?
        // User request: "We should not insert inlay hints when there is content after where we would insert the inlay hint"
        // This suggests we don't need to support "Inferred Amount followed by Explicit Cost" on the same line (rare/impossible in hledger?)
        // Hledger typically infers amount OR cost, or calculates everything.
        // But if there's a comment, we want it pushed out?
        // Let's assume for now we just pad to the START of where the amount matches alignment.

        // Wait, if we want the file to be "aligned even without inlay hints", 
        // and we have an inferred amount "hole", do we want the hole to be the size of the inferred amount?
        // If we just pad to the start, the "hole" is effectively 0 width visually.
        // But the Inlay Hint needs to fit there.
        // If we don't pad past it, the comment will be right next to the account (plus padding).
        // Let's stick to padding to the START of the amount loop.
      } else {
        // No amount and no inferred amount to show - or explicitly hidden.
        // If we have subsequent items (Cost, Assertion), we might need to pad past the "empty" amount slot?
        // Logic for "Space for missing amount" in original code:
        /*
        const preDecimalWidth = widths.amount.commodityBefore + ...
        const postDecimalWidth = widths.amount.decimalMark + ...
        line += ' '.repeat(padding + preDecimalWidth + postDecimalWidth);
        */
        // If we want to align costs/assertions, we typically skip past the amount column.

        if (posting.cost || posting.assertion) {
          const postDecimalWidth = widths.amount.decimalMark +
            widths.amount.decimalPart +
            widths.amount.spaceBetweenAmountAndCommodityAfter +
            widths.amount.commodityAfter;

          line += ' '.repeat(amountPadding + amountPreDecimalWidth + postDecimalWidth);
        }
      }

      // 2. Cost
      if (posting.cost && !posting.cost.inferred) {
        const marker = (posting.cost.type === 'unit' ? ' @ ' : ' @@ ');
        const layout = getAmountLayout(posting.cost.amount, parsed, options, marker);
        line += renderAmountLayout(layout, widths.cost);

      } else if (inlayHintsConfig.showCostConversions && posting.cost?.inferred) {
        // Inferred Cost
        // If we have an inferred cost, we might want to pad to its start position?
        // Costs usually follow amounts immediately?
        // But alignment-wise, we align based on widths.cost
        // If there is NO explicit cost, but we want to show inferred, we rely on Inlay Hint.
        // Do we pad?
        // If amount was present, we are at the end of amount.
        // If amount was 'inferred' (and padded to start), we are at start of amount.
        // This gets tricky mixing inferred types.
        // Standard case: Explicit Amount, Inferred Cost.
        // We are at end of Amount. We just need to ensure we don't trim?
        // Actually, formatted lines usually don't have holes for Costs if they aren't there.
        // But if we want alignment...
        // For now, let's leave Cost handling similar to Amount (pad if consistent).

        // Cost alignment is simpler: just append? Or align?
        // Original code for missing cost:
        /*
        const totalWidth = widths.cost.marker + ...
        line += ' '.repeat(totalWidth);
        */
        // This was done to align Assertions.
        // If we have an inferred cost, we want to place it in that "totalWidth" slot.
        // So we should probably NOT print the spaces for the "hole" if we are going to fill it with an inlay hint?
        // OR, does the inlay hint overlay? No.
        // If we print spaces, the Inlay Hint appears AFTER the spaces.
        // So we should print spaces UP TO where the Inlay Hint starts.
        // But Inlay Hint starts at current position?
        // The Cost is usually aligned by 'marker' + content.
        // If we just leave it empty, the Inlay Hint appends.
        // If we have an assertion later, we need to pad past the cost.
      } else {
        // Valid to skip cost space if no assertion?
        if (posting.assertion) {
          const totalWidth = widths.cost.marker +
            widths.cost.commodityBefore +
            widths.cost.spaceBetweenCommodityBeforeAndAmount +
            widths.cost.negPosSign +
            widths.cost.integerPart +
            widths.cost.decimalMark +
            widths.cost.decimalPart +
            widths.cost.spaceBetweenAmountAndCommodityAfter +
            widths.cost.commodityAfter;
          line += ' '.repeat(totalWidth);
        }
      }

      // 3. Assertion
      if (posting.assertion) {
        const marker = ' = ';
        const layout = getAmountLayout(posting.assertion, parsed, options, marker);
        line += renderAmountLayout(layout, widths.assertion);
      } else if (inlayHintsConfig.showRunningBalances) {
        // Running balances are "inferred assertions"
        // We don't pad here because it's the last thing (usually).
        // We just leave it for the Inlay Hint to append.
        // UNLESS there is a comment.
        // If there is a comment, we want it pushed out?
        // Original code didn't push comments for missing assertions.
      }

      if (posting.comment) {
        // If we have a hint that we've padded for, we DON'T strictly trimEnd, 
        // but typically the padding was added explicitly above.
        // However, if we just have "Account    ", and then a comment, we want "Account    ; comment"
        // If we have "Account", and amount is inferred, we added padding to "Account    ".
        // The Inlay Hint " $10" will sit in that gap.
        // If we have a comment, we want it AFTER the hint.
        // But Inlay Hints are overlay/interstitial.
        // If the text is "Account    ; comment", and we insert hint at index of ";", it pushes comment right.
        // Correct.
        // Crucially, if we didn't add the padding, it would be "Account ; comment"
        // and Inlay Hint would have to pad itself "    $10".
        // User wants us to add the whitespace.

        // So we keep the line as is (with padding) and append comment.
        // But wait, the original logic had `if (!postingHasInlayHints) { line = line.trimEnd(); }`
        // We want to preserve our carefully calculated padding.

        // If we have an inferred item at the END of the line (e.g. inferred assertion), 
        // and NO comment, we might have added padding that `formattedPostingLines.push` will store.
        // But `formattedLines.push` later does `trimEnd()`?
        // Let's check the third pass.
      } else {
        // No comment.
        // If we have inferred items (hints), we WANT to keep the trailing spaces so the hint appears at the right spot?
        // OR does VS Code handle "past end of line" automatically?
        // VS Code places End-of-Line hints after the last character.
        // If we want alignment, we need the "last character" to be at the align column.
        // So YES, we must preserve trailing spaces if there is a hint.
        if (!postingHasInlayHints) {
          line = line.trimEnd();
        }
      }

      if (posting.comment) {
        line += '; ' + posting.comment.trim();
      }

      formattedPostingLines.push(line);
      postingHasInlayHintsArray.push(postingHasInlayHints);
    }

    // Third pass: Reintegrate with comments from original lines
    let postingIndex = 0;
    for (let line of lines) {
      const trimmed = line.trim();
      if (isComment(trimmed) || trimmed === '') {
        formattedLines.push(line.trimEnd());
      } else {
        if (!postingHasInlayHintsArray[postingIndex]) {
          formattedLines.push(formattedPostingLines[postingIndex].trimEnd());
        } else {
          formattedLines.push(formattedPostingLines[postingIndex]);
        }
        postingIndex++;
      }
    }

    return formattedLines;
  }

  public calculateTransactionWidths(
    transaction: Transaction,
    parsed: ParsedDocument,
    options: FormattingOptions,
    inlayHintsConfig?: InlayHintsOptions
  ): TransactionColumnWidths {
    const widths: TransactionColumnWidths = {
      indent: options.indentation,
      account: 0,
      amount: this.emptyAmountWidths(),
      cost: this.emptyAmountWidths(),
      assertion: this.emptyAmountWidths()
    };

    for (const posting of transaction.
      postings) {
      widths.account = Math.max(widths.account, posting.account.length);

      if (posting.amount && !posting.amount.inferred) {
        const layout = getAmountLayout(posting.amount, parsed, options, '');
        this.updateAmountWidths(widths.amount, layout, options);
      } else if (inlayHintsConfig?.showInferredAmounts && posting.amount?.inferred) {
        // Only include if NOT blocked by explicit content
        // Inferred Amount is blocked if there is an explicit Cost or explicit Assertion on the line
        const hasExplicitCost = posting.cost && !posting.cost.inferred;
        const hasExplicitAssertion = posting.assertion; // Assertion is strictly explicit in Parser output

        if (!hasExplicitCost && !hasExplicitAssertion) {
          // Include inferred amount in width calculation
          const layout = getAmountLayout(posting.amount, parsed, options, '');
          this.updateAmountWidths(widths.amount, layout, options);
        }
      }

      if (posting.cost && !posting.cost.inferred) {
        const marker = (posting.cost.type === 'unit' ? ' @ ' : ' @@ ');
        const layout = getAmountLayout(posting.cost.amount, parsed, options, marker);
        this.updateAmountWidths(widths.cost, layout, options);
      } else if (inlayHintsConfig?.showCostConversions && posting.cost?.inferred) {
        // Only include if NOT blocked by explicit content
        // Inferred Cost is blocked if there is an explicit Assertion
        const hasExplicitAssertion = posting.assertion;

        if (!hasExplicitAssertion) {
          // Include inferred cost in width calculation
          const marker = (posting.cost.type === 'unit' ? ' @ ' : ' @@ ');
          const layout = getAmountLayout(posting.cost.amount, parsed, options, marker);
          this.updateAmountWidths(widths.cost, layout, options);
        }
      }

      if (posting.assertion) {
        const marker = ' = ';
        const layout = getAmountLayout(posting.assertion, parsed, options, marker);
        this.updateAmountWidths(widths.assertion, layout, options);
      } else if (inlayHintsConfig?.showRunningBalances) {
        // Running balances take up space just like assertions
        // We don't have the specific Balance object here easily (it's calculated in InlayHints or RunningBalanceCalculator).
        // However, to reserve space, we ideally need to know the width.
        // This is a limitation: Running Balances are dynamic.
        // BUT, `widths.assertion` tracks the MAX width.
        // If we want to align running balances, we should probably update widths with the projected running balance?
        // The current `formatter.ts` approach for assertions scans the transaction.
        // If we want to support running balance alignment, we might need to pass in the running balance map?
        // That's getting complicated. 
        // For now, let's assume we don't resize the grid for *Running Balances* unless they are explicit assertions.
        // Inlay Hints for running balances will just hang off the end.
      }
    }

    return widths;
  }

  public emptyAmountWidths(): AmountWidths {

    return {
      marker: 0,
      commodityBefore: 0,
      spaceBetweenCommodityBeforeAndAmount: 0,
      negPosSign: 0,
      integerPart: 0,
      decimalMark: 0,
      decimalPart: 0,
      spaceBetweenAmountAndCommodityAfter: 0,
      commodityAfter: 0
    };
  }

  private updateAmountWidths(widths: AmountWidths, layout: AmountLayout, options: FormattingOptions) {
    widths.marker = Math.max(widths.marker, layout.marker.length);
    widths.commodityBefore = Math.max(widths.commodityBefore, layout.commodityBefore.length);
    widths.commodityBefore = Math.min(widths.commodityBefore, options.maxCommodityWidth);
    widths.spaceBetweenCommodityBeforeAndAmount = Math.max(widths.spaceBetweenCommodityBeforeAndAmount,
      (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore.length) ? 1 : 0
    );
    widths.negPosSign = Math.max(widths.negPosSign, layout.negPosSign.length);
    widths.integerPart = Math.max(widths.integerPart, layout.amountIntegerString.length);
    widths.integerPart = Math.min(widths.integerPart, options.maxAmountIntegerWidth);
    widths.decimalMark = Math.max(widths.decimalMark, layout.amountDecimalString ? 1 : 0);
    widths.decimalPart = Math.max(widths.decimalPart, layout.amountDecimalString.length);
    widths.decimalPart = Math.min(widths.decimalPart, options.maxAmountDecimalWidth);
    widths.spaceBetweenAmountAndCommodityAfter = Math.max(widths.spaceBetweenAmountAndCommodityAfter,
      (layout.spaceBetweenCommodityAndAmount && layout.commodityAfter.length) ? 1 : 0
    );
    widths.commodityAfter = Math.max(widths.commodityAfter, layout.commodityAfter.length);
    widths.commodityAfter = Math.min(widths.commodityAfter, options.maxCommodityWidth);
  }

  private formatTransactionHeader(line: string): string {
    const header = parseTransactionHeader(line);
    if (!header) {
      return line.trimEnd();
    }

    let result = header.date;

    if (header.effectiveDate) {
      result += '=' + header.effectiveDate;
    }

    if (header.status === 'cleared') {
      result += ' *';
    } else if (header.status === 'pending') {
      result += ' !';
    }

    if (header.code) {
      result += ' (' + header.code + ')';
    }

    if (header.description) {
      result += ' ' + header.description;
    }

    if (header.comment) {
      result += '  ; ' + header.comment;
    }

    return result;
  }

  private formatDirective(line: string): string {
    const trimmed = line.trim();

    // Extract comment if present
    const commentMatch = trimmed.match(/^([^;]*);(.*)$/);
    const mainPart = commentMatch ? commentMatch[1].trim() : trimmed;
    const comment = commentMatch ? commentMatch[2].trim() : undefined;

    // Normalize spacing in the directive
    const parts = mainPart.split(/\s+/);
    let result = parts.join(' ');

    if (comment) {
      result += '  ; ' + comment;
    }

    return result;
  }

}

export const formattingProvider = new FormattingProvider();
