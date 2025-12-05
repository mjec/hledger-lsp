/**
 * Formatting provider for hledger journal files
 */

import { TextEdit, Range, Position, FormattingOptions as LSPFormattingOptions } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Amount, ParsedDocument, Posting, Commodity, Format, Transaction } from '../types';
import { parsePosting, parseTransactionHeader } from '../parser/ast';
import { isTransactionHeader, isPosting, isComment, isDirective } from '../utils/index';

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
}

interface amountLayout {
  commodityBefore: string;
  isNegative: boolean;
  amountIntegerString: string;
  amountDecimalString: string;
  demicalMark: string;
  commodityAfter: string;
  spaceBetweenCommodityAndAmount: boolean;
}

interface postingLayout {
  amountLayout?: amountLayout;
  costLayout?: amountLayout;
  assertionLayout?: amountLayout;
}


const DEFAULT_OPTIONS: Required<FormattingOptions> = {
  indentation: 4,
  maxAccountWidth: 42,
  maxCommodityWidth: 4,
  maxAmountWidth: 12,
  minSpacing: 2,
  decimalAlignColumn: 52,
  assertionDecimalAlignColumn: 70
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
        const transaction = parsed.transactions.find(t => t.line === i);

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

    let indentColumnWidth = 0;
    let accountColumnWidth = 0;
    let commodityBeforeColumnWidth = 0;
    let spaceBetweenCommodityBeforeAndAmount = 0;
    let negativeSignColumnWidth = 0;
    let amountIntegerColumnWidth = 0;
    let amountDecimalMarkColumnWidth = 0;
    let amountDecimalColumnWidth = 0;
    let spaceBetweenAmountAndCommodityAfterColumnWidth = 0;
    let commodityAfterColumnWidth = 0;
    let costColumnWidth = 0;
    let costCommodityBeforeColumnWidth = 0;
    let spaceBetweenCostCommodityBeforeAndAmount = 0;
    let costNegativeSignColumnWidth = 0;
    let costAmountIntegerColumnWidth = 0;
    let costAmountDecimalMarkColumnWidth = 0;
    let costAmountDecimalColumnWidth = 0;
    let spaceBetweenCostAmountAndCommodityAfterColumnWidth = 0;
    let costCommodityAfterColumnWidth = 0;
    let assertionColumnWidth = 0;
    let assertionCommodityBeforeColumnWidth = 0;
    let spaceBetweenAssertionCommodityBeforeAndAmount = 0;
    let assertionNegativeSignColumnWidth = 0;
    let assertionAmountIntegerColumnWidth = 0;
    let assertionAmountDecimalMarkColumnWidth = 0;
    let assertionAmountDecimalColumnWidth = 0;
    let spaceBetweenAssertionAmountAndCommodityAfterColumnWidth = 0;
    let assertionCommodityAfterColumnWidth = 0;

    // First pass: determine column widths and cache layouts
    const postingLayouts: postingLayout[] = [];
    for (let posting of transaction.postings) {
      let postingLayout: postingLayout = {};
      indentColumnWidth = Math.max(indentColumnWidth, options.indentation);
      accountColumnWidth = Math.max(accountColumnWidth, posting.account.length);

      if (posting.amount) {
        const layout = this.layoutAmount(posting.amount, parsed, options);
        postingLayout.amountLayout = layout;
        commodityBeforeColumnWidth = Math.max(commodityBeforeColumnWidth, layout.commodityBefore.length);
        negativeSignColumnWidth = Math.max(negativeSignColumnWidth, layout.isNegative ? 1 : 0);
        spaceBetweenCommodityBeforeAndAmount = Math.max(spaceBetweenCommodityBeforeAndAmount, (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore.length) ? 1 : 0);
        amountIntegerColumnWidth = Math.max(amountIntegerColumnWidth, layout.amountIntegerString.length);
        amountDecimalMarkColumnWidth = Math.max(amountDecimalMarkColumnWidth, layout.amountDecimalString ? 1 : 0);
        amountDecimalColumnWidth = Math.max(amountDecimalColumnWidth, layout.amountDecimalString.length);
        spaceBetweenAmountAndCommodityAfterColumnWidth = Math.max(spaceBetweenAmountAndCommodityAfterColumnWidth, (layout.spaceBetweenCommodityAndAmount && layout.commodityAfter.length) ? 1 : 0);
        commodityAfterColumnWidth = Math.max(commodityAfterColumnWidth, layout.commodityAfter.length);
      }

      if (posting.cost) {
        const layout = this.layoutAmount(posting.cost.amount, parsed, options);
        postingLayout.costLayout = layout;
        costColumnWidth = Math.max(costColumnWidth, posting.cost.type === 'unit' ? 3 : 4);
        costCommodityBeforeColumnWidth = Math.max(costCommodityBeforeColumnWidth, layout.commodityBefore.length);
        costNegativeSignColumnWidth = Math.max(costNegativeSignColumnWidth, layout.isNegative ? 1 : 0);
        spaceBetweenCostCommodityBeforeAndAmount = Math.max(spaceBetweenCostCommodityBeforeAndAmount, (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore.length) ? 1 : 0);
        costAmountIntegerColumnWidth = Math.max(costAmountIntegerColumnWidth, layout.amountIntegerString.length);
        costAmountDecimalMarkColumnWidth = Math.max(costAmountDecimalMarkColumnWidth, layout.amountDecimalString ? 1 : 0);
        costAmountDecimalColumnWidth = Math.max(costAmountDecimalColumnWidth, layout.amountDecimalString.length);
        spaceBetweenCostAmountAndCommodityAfterColumnWidth = Math.max(spaceBetweenCostAmountAndCommodityAfterColumnWidth, (layout.spaceBetweenCommodityAndAmount && layout.commodityAfter.length) ? 1 : 0);
        costCommodityAfterColumnWidth = Math.max(costCommodityAfterColumnWidth, layout.commodityAfter.length);
      }

      if (posting.assertion) {
        const layout = this.layoutAmount(posting.assertion, parsed, options);
        postingLayout.assertionLayout = layout;
        assertionColumnWidth = Math.max(assertionColumnWidth, 3); // for the assertion operator with spaces
        assertionCommodityBeforeColumnWidth = Math.max(assertionCommodityBeforeColumnWidth, layout.commodityBefore.length);
        assertionNegativeSignColumnWidth = Math.max(assertionNegativeSignColumnWidth, layout.isNegative ? 1 : 0);
        spaceBetweenAssertionCommodityBeforeAndAmount = Math.max(spaceBetweenAssertionCommodityBeforeAndAmount, layout.isNegative ? 1 : 0);
        assertionAmountIntegerColumnWidth = Math.max(assertionAmountIntegerColumnWidth, layout.amountIntegerString.length);
        assertionAmountDecimalMarkColumnWidth = Math.max(assertionAmountDecimalMarkColumnWidth, layout.amountDecimalString ? 1 : 0);
        assertionAmountDecimalColumnWidth = Math.max(assertionAmountDecimalColumnWidth, layout.amountDecimalString.length);
        spaceBetweenAssertionAmountAndCommodityAfterColumnWidth = Math.max(spaceBetweenAssertionAmountAndCommodityAfterColumnWidth, (layout.spaceBetweenCommodityAndAmount && layout.commodityAfter.length) ? 1 : 0);
        assertionCommodityAfterColumnWidth = Math.max(assertionCommodityAfterColumnWidth, layout.commodityAfter.length);
      }
      postingLayouts.push(postingLayout);
    }

    // Second pass: format each posting line
    const formattedPostingLines: string[] = [];
    for (let idx = 0; idx < transaction.postings.length; idx++) {
      const posting = transaction.postings[idx];
      const postingLayout = postingLayouts[idx];
      let line = ' '.repeat(options.indentation);
      line += posting.account.padEnd(accountColumnWidth, ' ');
      line += ' '.repeat(options.minSpacing);


      if (posting.amount) {
        const lengthAtPaddingLocation = line.length;
        const layout = postingLayout.amountLayout!;
        line += layout.commodityBefore.padStart(commodityBeforeColumnWidth, ' ');
        line += ' '.repeat(spaceBetweenCommodityBeforeAndAmount);
        line += layout.isNegative ? '-'.padStart(negativeSignColumnWidth, ' ') : ' '.repeat(negativeSignColumnWidth);
        line += layout.amountIntegerString.padStart(amountIntegerColumnWidth, ' ');
        const lengthAtDecimalLocation = line.length;
        const targetDecimalColumn = options.decimalAlignColumn;
        const linePrePadding = line.substring(0, lengthAtPaddingLocation);
        const linePostPadding = line.substring(lengthAtPaddingLocation);
        const currentDecimalColumn = lengthAtDecimalLocation;
        const neededPadding = targetDecimalColumn - currentDecimalColumn;
        line = linePrePadding + ' '.repeat(Math.max(0, neededPadding)) + linePostPadding;
        if (layout.demicalMark) {
          line += layout.demicalMark.padEnd(amountDecimalMarkColumnWidth, ' ');
          line += layout.amountDecimalString.padEnd(amountDecimalColumnWidth, ' ');
        } else {
          line += ' '.repeat(amountDecimalMarkColumnWidth + amountDecimalColumnWidth);
        }
        line += ' '.repeat(spaceBetweenAmountAndCommodityAfterColumnWidth);
        line += layout.commodityAfter.padEnd(commodityAfterColumnWidth, ' ');
      } else {
        const lengthAtPaddingLocation = line.length;
        const neededPadding = options.decimalAlignColumn - lengthAtPaddingLocation;
        line += ' '.repeat(Math.max(0, neededPadding));
        line += ' '.repeat(
          amountDecimalMarkColumnWidth +
          amountDecimalColumnWidth +
          spaceBetweenAmountAndCommodityAfterColumnWidth +
          commodityAfterColumnWidth
        ); // space for missing amount
      }

      if (posting.cost) {
        const layout = postingLayout.costLayout!;
        line += posting.cost.type === 'unit' ? ' @'.padEnd(costColumnWidth, ' ') : ' @@'.padEnd(costColumnWidth, ' ');
        line += layout.commodityBefore.padStart(costCommodityBeforeColumnWidth, ' ');
        line += ' '.repeat(spaceBetweenCostCommodityBeforeAndAmount);
        line += layout.isNegative ? '-'.padStart(costNegativeSignColumnWidth, ' ') : ' '.repeat(costNegativeSignColumnWidth);
        line += layout.amountIntegerString.padStart(costAmountIntegerColumnWidth, ' ');
        if (layout.demicalMark) {
          line += layout.demicalMark.padEnd(costAmountDecimalMarkColumnWidth, ' ');
          line += layout.amountDecimalString.padEnd(costAmountDecimalColumnWidth, ' ');
        } else {
          line += ' '.repeat(costAmountDecimalColumnWidth + costAmountDecimalMarkColumnWidth);
        }
        line += ' '.repeat(spaceBetweenCostAmountAndCommodityAfterColumnWidth);
        line += layout.commodityAfter.padEnd(costCommodityAfterColumnWidth, ' ');
      } else {
        line += ' '.repeat(costColumnWidth +
          costCommodityBeforeColumnWidth +
          spaceBetweenCostCommodityBeforeAndAmount +
          costNegativeSignColumnWidth +
          costAmountIntegerColumnWidth +
          costAmountDecimalMarkColumnWidth +
          costAmountDecimalColumnWidth +
          spaceBetweenCostAmountAndCommodityAfterColumnWidth +
          costCommodityAfterColumnWidth
        ); // space for missing cost
      }

      if (posting.assertion) {
        const layout = postingLayout.assertionLayout!;
        line += ' ='.padEnd(assertionColumnWidth, ' ');
        line += layout.commodityBefore.padStart(assertionCommodityBeforeColumnWidth, ' ');
        line += ' '.repeat(spaceBetweenAssertionCommodityBeforeAndAmount);
        line += layout.isNegative ? '-'.padStart(assertionNegativeSignColumnWidth, ' ') : ' '.repeat(assertionNegativeSignColumnWidth);
        line += layout.amountIntegerString.padStart(assertionAmountIntegerColumnWidth, ' ');
        if (layout.demicalMark) {
          line += layout.demicalMark.padEnd(assertionAmountDecimalMarkColumnWidth, ' ');
          line += layout.amountDecimalString.padEnd(assertionAmountDecimalColumnWidth, ' ');
        } else {
          line += ' '.repeat(assertionAmountDecimalColumnWidth + assertionAmountDecimalMarkColumnWidth);
        }
        line += ' '.repeat(spaceBetweenAssertionAmountAndCommodityAfterColumnWidth);
        line += layout.commodityAfter.padEnd(assertionCommodityAfterColumnWidth, ' ');
      } else {
        line += ' '.repeat(2 + // space for spaces around assertion indicator
          assertionColumnWidth +
          assertionCommodityBeforeColumnWidth +
          spaceBetweenAssertionCommodityBeforeAndAmount +
          assertionNegativeSignColumnWidth +
          assertionAmountIntegerColumnWidth +
          assertionAmountDecimalColumnWidth +
          assertionAmountDecimalMarkColumnWidth +
          spaceBetweenAssertionAmountAndCommodityAfterColumnWidth +
          assertionCommodityAfterColumnWidth
        ); // space for missing assertion
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


  private layoutAmount(amount: Amount, parsed: ParsedDocument, options: Required<FormattingOptions>): amountLayout {
    const commodity = this.findCommodity(amount.commodity, parsed);
    let format: Format = {};
    let declaredPrecision: number | undefined = undefined;

    if (commodity && commodity.format) {
      format = commodity.format;
      declaredPrecision = commodity.format.precision ?? undefined;
    } else if (amount.format) {
      format = amount.format;
    } else {
      format = {};
    }

    // Determine the actual precision to use based on the rules:
    // 1. Never reduce precision if posting has higher precision than declared
    // 2. Add zeros to match declared precision when actual < declared
    // 3. Don't change formatting when commodity is not declared
    const actualPrecision = amount.format?.precision ?? undefined;
    let targetPrecision: number | undefined = undefined;

    if (declaredPrecision !== undefined) {
      // Commodity is declared - use max of actual and declared precision
      if (actualPrecision !== undefined) {
        targetPrecision = Math.max(actualPrecision, declaredPrecision);
      } else {
        targetPrecision = declaredPrecision;
      }
    } else {
      // Commodity is not declared - preserve original precision
      targetPrecision = actualPrecision;
    }

    return {
      commodityBefore: format.symbolOnLeft ? format.symbol || '' : '',
      isNegative: amount.quantity < 0,
      amountIntegerString: this.formatIntegerAmount(amount, format),
      amountDecimalString: this.formatDecimalAmount(amount, format, targetPrecision),
      demicalMark: targetPrecision && targetPrecision > 0 ? (format.decimalMark || '.') : '',
      spaceBetweenCommodityAndAmount: format.spaceBetween || false,
      commodityAfter: !format.symbolOnLeft ? format.symbol || '' : ''
    };
  }

  private formatIntegerAmount(amount: Amount, format: Format): string {
    const integerPart = Math.floor(Math.abs(amount.quantity)).toString();

    // Format integer part with grouping if specified
    let integerString = '';
    if (format.thousandsSeparator) {
      const regex = /\B(?=(\d{3})+(?!\d))/g;
      integerString = integerPart.replace(regex, format.thousandsSeparator);
    } else {
      integerString = integerPart;
    }

    return integerString;
  }

  private formatDecimalAmount(amount: Amount, format: Format, targetPrecision?: number): string {
    const decimalPart = Math.abs(amount.quantity) % 1;

    // Format decimal part based on target precision
    let decimalString = '';
    if (targetPrecision !== undefined && targetPrecision > 0) {
      decimalString = decimalPart.toFixed(targetPrecision).substring(2); // Skip "0."
    } else if (decimalPart > 0) {
      decimalString = decimalPart.toString().substring(2); // Skip "0."
    }

    return decimalString;
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
