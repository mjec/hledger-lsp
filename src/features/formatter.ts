/**
 * Formatting provider for hledger journal files
 */

import { TextEdit, Range, Position, FormattingOptions as LSPFormattingOptions } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Amount, ParsedDocument, Posting, Commodity, Format, Transaction } from '../types';
import { parseTransactionHeader } from '../parser/ast';
import { isTransactionHeader, isPosting, isComment, isDirective } from '../utils/index';
import { getAmountLayout, AmountLayout } from '../utils/amountFormatter';

export interface FormattingOptions {
  /** Number of spaces for posting indentation (default: 4) */
  indentation?: number;
  /** Maximum width for account names (default: 42) */
  maxAccountWidth?: number;
  /** Maximum width for commodity symbols (default: 4) */
  maxCommodityWidth?: number;
  /** Maximum width for amount numbers (default: 12) */
  maxAmountWidth?: number;
  /** Minimum spaces between account and amount (default: 2) */
  minSpacing?: number;
  /** Target column for decimal alignment (default: 52) */
  decimalAlignColumn?: number;
  /** Target column for assertion decimal alignment (default: 70) */
  assertionDecimalAlignColumn?: number;
  /** Placement of negative sign for prefix commodities (default: 'after-symbol') */
  signPosition?: 'before-symbol' | 'after-symbol';
}




interface AmountColumnWidths {
  commodityBefore: number;
  spaceBetweenCommodityBeforeAndAmount: number;
  negativeSign: number;
  integer: number;
  decimalMark: number;
  decimal: number;
  spaceBetweenAmountAndCommodityAfter: number;
  commodityAfter: number;
}

interface TransactionColumnWidths {
  indent: number;
  account: number;
  amount: AmountColumnWidths;
  cost: AmountColumnWidths & { marker: number };
  assertion: AmountColumnWidths & { marker: number };
}

const DEFAULT_OPTIONS: Required<FormattingOptions> = {
  indentation: 4,
  maxAccountWidth: 42,
  maxCommodityWidth: 4,
  maxAmountWidth: 12,
  minSpacing: 2,
  decimalAlignColumn: 52,
  assertionDecimalAlignColumn: 70,
  signPosition: 'after-symbol'
};


export class FormattingProvider {
  /**
   * Format an entire document
   */
  formatDocument(
    document: TextDocument,
    parsed: ParsedDocument,
    _lspOptions: LSPFormattingOptions,
    userOptions: Partial<FormattingOptions> = {}
  ): TextEdit[] {
    const options = { ...DEFAULT_OPTIONS, ...userOptions };
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

        // Find the corresponding transaction in the parsed document
        // to get inferred costs and other parsing results


        const transaction = parsed.transactions.find(t => (t.line === i && t.sourceUri?.toString() === document.uri));

        // Collect and format all postings in this transaction
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
        formattedLines.push(...this.formatTransactionLines(transactionLines, transaction, parsed, options));

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

  private formatTransactionLines(
    lines: string[],
    transaction: Transaction | undefined, parsed: ParsedDocument,
    options: Required<FormattingOptions>
  ): string[] {
    let formattedLines: string[] = [];

    if (!transaction) {
      // No transaction info, just trim lines
      formattedLines = lines.map(line => line.trimEnd());
      return formattedLines;
    }

    // First pass: Calculate all column widths
    const widths = this.calculateTransactionWidths(transaction, parsed, options);

    // Second pass: format each posting line
    const formattedPostingLines: string[] = [];
    for (let posting of transaction.postings) {
      let line = ' '.repeat(options.indentation);
      line += posting.account.padEnd(widths.account, ' ');
      line += ' '.repeat(options.minSpacing);

      // 1. Amount
      if (posting.amount && !posting.amount.inferred) {
        const layout = getAmountLayout(posting.amount, parsed, options);
        const amountBlock = this.formatAlignedAmount(layout, widths.amount, options);

        // Calculate decimal alignment padding
        const preDecimalWidth = widths.amount.commodityBefore +
          widths.amount.spaceBetweenCommodityBeforeAndAmount +
          widths.amount.negativeSign +
          widths.amount.integer;

        const currentLen = line.length;
        const targetLen = options.decimalAlignColumn;
        const padding = Math.max(0, targetLen - currentLen - preDecimalWidth);

        line += ' '.repeat(padding) + amountBlock;
      } else {
        // Space for missing amount
        const preDecimalWidth = widths.amount.commodityBefore +
          widths.amount.spaceBetweenCommodityBeforeAndAmount +
          widths.amount.negativeSign +
          widths.amount.integer;
        const postDecimalWidth = widths.amount.decimalMark +
          widths.amount.decimal +
          widths.amount.spaceBetweenAmountAndCommodityAfter +
          widths.amount.commodityAfter;

        const currentLen = line.length;
        const targetLen = options.decimalAlignColumn;
        const padding = Math.max(0, targetLen - currentLen - preDecimalWidth);

        line += ' '.repeat(padding + preDecimalWidth + postDecimalWidth);
      }

      // 2. Cost
      if (posting.cost && !posting.cost.inferred) {
        const layout = getAmountLayout(posting.cost.amount, parsed, options);
        // Ensure marker (" @" or " @@") is padded to width
        line += (posting.cost.type === 'unit' ? ' @' : ' @@').padEnd(widths.cost.marker, ' ');
        line += this.formatAlignedAmount(layout, widths.cost, options);
      } else {
        const totalWidth = widths.cost.marker +
          widths.cost.commodityBefore +
          widths.cost.spaceBetweenCommodityBeforeAndAmount +
          widths.cost.negativeSign +
          widths.cost.integer +
          widths.cost.decimalMark +
          widths.cost.decimal +
          widths.cost.spaceBetweenAmountAndCommodityAfter +
          widths.cost.commodityAfter;
        line += ' '.repeat(totalWidth);
      }

      // 3. Assertion
      if (posting.assertion) {
        const layout = getAmountLayout(posting.assertion, parsed, options);
        line += ' ='.padEnd(widths.assertion.marker, ' ');
        line += this.formatAlignedAmount(layout, widths.assertion, options);
      } else {
        const totalWidth = widths.assertion.marker +
          widths.assertion.commodityBefore +
          widths.assertion.spaceBetweenCommodityBeforeAndAmount +
          widths.assertion.negativeSign +
          widths.assertion.integer +
          widths.assertion.decimalMark +
          widths.assertion.decimal +
          widths.assertion.spaceBetweenAmountAndCommodityAfter +
          widths.assertion.commodityAfter;
        line += ' '.repeat(totalWidth);
      }

      if (posting.comment) {
        line = line.trimEnd();
        line += ';' + posting.comment.trim();
      }

      formattedPostingLines.push(line);
    }

    // Third pass: Reintegrate with comments from original lines
    let postingIndex = 0;
    for (let line of lines) {
      const trimmed = line.trim();
      if (isComment(trimmed) || trimmed === '') {
        formattedLines.push(line.trimEnd());
      } else {
        formattedLines.push(formattedPostingLines[postingIndex].trimEnd());
        postingIndex++;
      }
    }

    return formattedLines;
  }

  private calculateTransactionWidths(
    transaction: Transaction,
    parsed: ParsedDocument,
    options: Required<FormattingOptions>
  ): TransactionColumnWidths {
    const widths: TransactionColumnWidths = {
      indent: options.indentation,
      account: 0,
      amount: this.emptyAmountWidths(),
      cost: { ...this.emptyAmountWidths(), marker: 0 },
      assertion: { ...this.emptyAmountWidths(), marker: 0 }
    };

    for (const posting of transaction.postings) {
      widths.account = Math.max(widths.account, posting.account.length);

      if (posting.amount && !posting.amount.inferred) {
        const layout = getAmountLayout(posting.amount, parsed, options);
        this.updateAmountWidths(widths.amount, layout);
      }

      if (posting.cost && !posting.cost.inferred) {
        const layout = getAmountLayout(posting.cost.amount, parsed, options);
        this.updateAmountWidths(widths.cost, layout);
        // Cost marker width (@ or @@) - " @" (2) or " @@" (3)
        // We pad to min 3 or 4.
        // Original code: `Math.max(..., posting.cost.type === 'unit' ? 3 : 4)`
        widths.cost.marker = Math.max(widths.cost.marker, posting.cost.type === 'unit' ? 3 : 4);
      }

      if (posting.assertion) {
        const layout = getAmountLayout(posting.assertion, parsed, options);
        this.updateAmountWidths(widths.assertion, layout);
        // Assertion marker " ="
        widths.assertion.marker = Math.max(widths.assertion.marker, 3);
      }
    }
    return widths;
  }

  private emptyAmountWidths(): AmountColumnWidths {
    return {
      commodityBefore: 0,
      spaceBetweenCommodityBeforeAndAmount: 0,
      negativeSign: 0,
      integer: 0,
      decimalMark: 0,
      decimal: 0,
      spaceBetweenAmountAndCommodityAfter: 0,
      commodityAfter: 0
    };
  }

  private updateAmountWidths(widths: AmountColumnWidths, layout: AmountLayout) {
    widths.commodityBefore = Math.max(widths.commodityBefore, layout.commodityBefore.length);
    widths.spaceBetweenCommodityBeforeAndAmount = Math.max(widths.spaceBetweenCommodityBeforeAndAmount,
      (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore.length) ? 1 : 0
    );
    widths.negativeSign = Math.max(widths.negativeSign, layout.isNegative ? 1 : 0);
    widths.integer = Math.max(widths.integer, layout.amountIntegerString.length);
    widths.decimalMark = Math.max(widths.decimalMark, layout.amountDecimalString ? 1 : 0);
    widths.decimal = Math.max(widths.decimal, layout.amountDecimalString.length);
    widths.spaceBetweenAmountAndCommodityAfter = Math.max(widths.spaceBetweenAmountAndCommodityAfter,
      (layout.spaceBetweenCommodityAndAmount && layout.commodityAfter.length) ? 1 : 0
    );
    widths.commodityAfter = Math.max(widths.commodityAfter, layout.commodityAfter.length);
  }

  private formatAlignedAmount(
    layout: AmountLayout,
    widths: AmountColumnWidths,
    options: Required<FormattingOptions>
  ): string {
    let segment = '';
    if (layout.negativeSignBefore) {
      segment += layout.isNegative ? '-'.padStart(widths.negativeSign, ' ') : ' '.repeat(widths.negativeSign);
      segment += layout.commodityBefore.padStart(widths.commodityBefore, ' ');
    } else {
      segment += layout.commodityBefore.padStart(widths.commodityBefore, ' ');
      segment += layout.isNegative ? '-'.padStart(widths.negativeSign, ' ') : ' '.repeat(widths.negativeSign);
    }
    segment += ' '.repeat(widths.spaceBetweenCommodityBeforeAndAmount);
    segment += layout.amountIntegerString.padStart(widths.integer, ' ');

    // Note: Alignment padding is handled by caller before this block if needed (for decimal alignment)

    if (layout.demicalMark) {
      segment += layout.demicalMark.padEnd(widths.decimalMark, ' ');
      segment += layout.amountDecimalString.padEnd(widths.decimal, ' ');
    } else {
      segment += ' '.repeat(widths.decimalMark + widths.decimal);
    }
    segment += ' '.repeat(widths.spaceBetweenAmountAndCommodityAfter);
    segment += layout.commodityAfter.padEnd(widths.commodityAfter, ' ');

    return segment;
  }





  /**
   * Format a range of lines
   */
  formatRange(
    document: TextDocument,
    _range: Range,
    parsed: ParsedDocument,
    _lspOptions: LSPFormattingOptions,
    userOptions: Partial<FormattingOptions> = {}
  ): TextEdit[] {
    // For range formatting, we format the entire document and then extract the range
    // This ensures consistency when formatting partial selections
    return this.formatDocument(document, parsed, _lspOptions, userOptions);
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
    userOptions: Partial<FormattingOptions> = {}
  ): TextEdit[] {
    // Only format on newline
    if (ch !== '\n') {
      return [];
    }

    // Format the entire document to maintain alignment
    return this.formatDocument(document, parsed, _lspOptions, userOptions);
  }

  /**
   * Format a transaction header
   */
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

  /**
   * Format a directive
   */
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

  /**
   * Find the commodity format from parsed document
   */
  private findCommodity(commodityName: string, parsed: ParsedDocument): Commodity | undefined {
    return parsed.commodities.get(commodityName);
  }
}

export const formattingProvider = new FormattingProvider();
