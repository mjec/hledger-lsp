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
import { HledgerSettings, FormattingOptions, DEFAULT_FORMATTING_OPTIONS, InlayHintsOptions, DEFAULT_INLAY_HINTS_OPTIONS } from '../server/settings';
import { isSafeToFormat } from './formattingValidation';

interface TransactionColumnWidths {
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
        const baseLineNumber = transaction?.line ? transaction.line + 1 : i;
        formattedLines.push(...this.formatTransactionLines(transactionLines, transaction, parsed, options, inlayHintsConfig, documentUri, baseLineNumber));

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
    documentUri: string,
    baseLineNumber: number
  ): string[] {
    let formattedLines: string[] = [];
    let postingHasInlayHintsArray: boolean[] = [];

    if (!transaction) {
      // No transaction info, just trim lines
      formattedLines = lines.map(line => line.trimEnd());
      return formattedLines;
    }

    // First pass: Calculate all column widths
    const widths = this.calculateTransactionWidths(transaction, parsed, options);

    // Second pass: Validate and format each posting line
    const formattedPostingLines: string[] = [];
    const validationResults: boolean[] = []; // Track which lines passed validation

    for (let postingIndex = 0; postingIndex < transaction.postings.length; postingIndex++) {
      const posting = transaction.postings[postingIndex];
      const lineNumber = baseLineNumber + postingIndex;
      const originalLine = lines[postingIndex] || '';

      // Validate posting before formatting
      // Note: Diagnostics are now generated by the Validator class on document change
      // Here we only check if it's safe to format
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
      line += posting.account.padEnd(widths.account, ' ');
      line += ' '.repeat(2); // Minimum two spaces after account name
      const postingHasInlayHints = (inlayHintsConfig.showInferredAmounts && posting.amount?.inferred) ||
        (inlayHintsConfig.showCostConversions && posting.cost?.inferred) || (inlayHintsConfig.showRunningBalances) || false;
      // 1. Amount
      if (posting.amount && !posting.amount.inferred) {
        const marker = '';
        const layout: AmountLayout = getAmountLayout(posting.amount, parsed, options, marker);
        const amountBlock = renderAmountLayout(layout, widths.amount);

        // Calculate decimal alignment padding
        const preDecimalWidth = widths.amount.commodityBefore +
          widths.amount.spaceBetweenCommodityBeforeAndAmount +
          widths.amount.negPosSign +
          widths.amount.integerPart;

        const currentLen = line.length;
        const targetLen = options.decimalAlignColumn;
        const padding = Math.max(0, targetLen - currentLen - preDecimalWidth);

        line += ' '.repeat(padding) + amountBlock;
      } else {
        // Space for missing amount
        const preDecimalWidth = widths.amount.commodityBefore +
          widths.amount.spaceBetweenCommodityBeforeAndAmount +
          widths.amount.negPosSign +
          widths.amount.integerPart;
        const postDecimalWidth = widths.amount.decimalMark +
          widths.amount.decimalPart +
          widths.amount.spaceBetweenAmountAndCommodityAfter +
          widths.amount.commodityAfter;

        const currentLen = line.length;
        const targetLen = options.decimalAlignColumn;
        const padding = Math.max(0, targetLen - currentLen - preDecimalWidth);

        line += ' '.repeat(padding + preDecimalWidth + postDecimalWidth);
      }

      // 2. Cost
      if (posting.cost && !posting.cost.inferred) {
        const marker = (posting.cost.type === 'unit' ? ' @ ' : ' @@ ');
        const layout = getAmountLayout(posting.cost.amount, parsed, options, marker);
        line += renderAmountLayout(layout, widths.cost);

      } else {
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

      // 3. Assertion
      if (posting.assertion) {
        const marker = ' = ';
        const layout = getAmountLayout(posting.assertion, parsed, options, marker);
        line += renderAmountLayout(layout, widths.assertion);

      } else {
        const totalWidth = widths.assertion.marker +
          widths.assertion.commodityBefore +
          widths.assertion.spaceBetweenCommodityBeforeAndAmount +
          widths.assertion.negPosSign +
          widths.assertion.integerPart +
          widths.assertion.decimalMark +
          widths.assertion.decimalPart +
          widths.assertion.spaceBetweenAmountAndCommodityAfter +
          widths.assertion.commodityAfter;
        line += ' '.repeat(totalWidth);
      }

      if (posting.comment) {
        if (!postingHasInlayHints) {
          line = line.trimEnd();
        }
        line += ';' + posting.comment.trim();
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

  private calculateTransactionWidths(
    transaction: Transaction,
    parsed: ParsedDocument,
    options: FormattingOptions
  ): TransactionColumnWidths {
    const widths: TransactionColumnWidths = {
      indent: options.indentation,
      account: 0,
      amount: this.emptyAmountWidths(),
      cost: this.emptyAmountWidths(),
      assertion: this.emptyAmountWidths()
    };

    for (const posting of transaction.postings) {
      widths.account = Math.max(widths.account, posting.account.length);

      if (posting.amount && !posting.amount.inferred) {
        const layout = getAmountLayout(posting.amount, parsed, options, '');
        this.updateAmountWidths(widths.amount, layout);
      }

      if (posting.cost && !posting.cost.inferred) {
        const marker = (posting.cost.type === 'unit' ? ' @ ' : ' @@ ');
        const layout = getAmountLayout(posting.cost.amount, parsed, options, marker);
        this.updateAmountWidths(widths.cost, layout);
      }

      if (posting.assertion) {
        const marker = ' = ';
        const layout = getAmountLayout(posting.assertion, parsed, options, marker);
        this.updateAmountWidths(widths.assertion, layout);
      }
    }
    return widths;
  }

  private emptyAmountWidths(): AmountWidths {

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

  private updateAmountWidths(widths: AmountWidths, layout: AmountLayout) {

    widths.commodityBefore = Math.max(widths.commodityBefore, layout.commodityBefore.length);
    widths.spaceBetweenCommodityBeforeAndAmount = Math.max(widths.spaceBetweenCommodityBeforeAndAmount,
      (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore.length) ? 1 : 0
    );
    widths.negPosSign = Math.max(widths.negPosSign, layout.negPosSign.length);
    widths.integerPart = Math.max(widths.integerPart, layout.amountIntegerString.length);
    widths.decimalMark = Math.max(widths.decimalMark, layout.amountDecimalString ? 1 : 0);
    widths.decimalPart = Math.max(widths.decimalPart, layout.amountDecimalString.length);
    widths.spaceBetweenAmountAndCommodityAfter = Math.max(widths.spaceBetweenAmountAndCommodityAfter,
      (layout.spaceBetweenCommodityAndAmount && layout.commodityAfter.length) ? 1 : 0
    );
    widths.commodityAfter = Math.max(widths.commodityAfter, layout.commodityAfter.length);
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
      result += '  ;' + header.comment;
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
      result += '  ;' + comment;
    }

    return result;
  }

}

export const formattingProvider = new FormattingProvider();
