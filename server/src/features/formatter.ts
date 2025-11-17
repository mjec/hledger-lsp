/**
 * Formatting provider for hledger journal files
 */

import { TextEdit, Range, Position, FormattingOptions as LSPFormattingOptions } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Amount, ParsedDocument, Posting, Commodity } from '../types';
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

const DEFAULT_OPTIONS: Required<FormattingOptions> = {
  indentation: 4,
  maxAccountWidth: 42,
  maxCommodityWidth: 4,
  maxAmountWidth: 12,
  minSpacing: 2,
  decimalAlignColumn: 52,
  assertionDecimalAlignColumn: 70
};

interface ParsedAmount {
  commodityBefore: string;
  amountNumber: string;
  commodityAfter: string;
  decimalPosition: number; // Position of decimal within amountNumber, or length if no decimal
}

interface ParsedAssertion {
  commodityBefore: string;
  amountNumber: string;
  commodityAfter: string;
  decimalPosition: number;
}

interface ParsedCost {
  type: 'unit' | 'total';  // @ or @@
  commodityBefore: string;
  amountNumber: string;
  commodityAfter: string;
  decimalPosition: number;
}

interface PostingLayout {
  posting: Posting;
  indent: string;
  account: string;
  parsedAmount: ParsedAmount | null;
  parsedCost: ParsedCost | null;
  parsedAssertion: ParsedAssertion | null;
  comment: string;
}

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
        const postingLayouts: PostingLayout[] = [];
        i++;

        while (i < lines.length) {
          const postingLine = lines[i];
          const postingTrimmed = postingLine.trim();

          // Stop at empty line, next transaction, or directive
          if (!postingTrimmed || isTransactionHeader(postingTrimmed) || isDirective(postingTrimmed)) {
            break;
          }

          if (isComment(postingTrimmed)) {
            // Preserve comments between postings as-is
            formattedLines.push(postingTrimmed);
          } else if (isPosting(postingLine)) {  // Check with original line, not trimmed
            // Use the parsed transaction's postings if available (includes inferred costs)
            if (transaction && postingLayouts.length < transaction.postings.length) {
              const posting = transaction.postings[postingLayouts.length];
              const layout = this.parsePostingLayout(posting, parsed, options);
              postingLayouts.push(layout);
            } else {
              // Fallback to parsing from text if transaction not found
              const posting = parsePosting(postingLine);
              if (posting) {
                const layout = this.parsePostingLayout(posting, parsed, options);
                postingLayouts.push(layout);
              }
            }
          }

          i++;
        }

        // Format all postings in the transaction together for alignment
        const formattedPostings = this.formatTransactionPostings(postingLayouts, options);
        formattedLines.push(...formattedPostings);

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
   * Parse a posting into its layout components
   */
  private parsePostingLayout(
    posting: Posting,
    parsed: ParsedDocument,
    options: Required<FormattingOptions>
  ): PostingLayout {
    const indent = ' '.repeat(options.indentation);
    const account = posting.account;

    const parsedAmount = posting.amount
      ? this.parseAmount(posting.amount, parsed)
      : null;

    const parsedCost = posting.cost
      ? this.parseCost(posting.cost, parsed)
      : null;

    const parsedAssertion = posting.assertion
      ? this.parseAmount(posting.assertion, parsed)
      : null;

    const comment = posting.comment || '';

    return {
      posting,
      indent,
      account,
      parsedAmount,
      parsedCost,
      parsedAssertion,
      comment
    };
  }

  /**
   * Parse an amount into its components for column alignment
   */
  private parseAmount(amount: Amount, parsed: ParsedDocument): ParsedAmount {
    const commodity = this.findCommodity(amount.commodity, parsed);
    const absQuantity = Math.abs(amount.quantity);
    const isNegative = amount.quantity < 0;

    // Determine precision
    const actualPrecision = this.getDecimalPlaces(amount.quantity);
    const usePrecision = commodity?.format?.precision !== null && commodity?.format?.precision !== undefined
      ? Math.max(actualPrecision, commodity.format.precision)
      : actualPrecision;

    // Format the number
    const formattedNumber = absQuantity.toFixed(usePrecision);
    const decimalPos = formattedNumber.indexOf('.');
    const decimalPosition = decimalPos >= 0 ? decimalPos : formattedNumber.length;

    // Build amount string with negative sign
    const amountNumber = (isNegative ? '-' : '') + formattedNumber;

    // Determine commodity placement
    const commoditySymbol = commodity?.format?.symbol || amount.commodity || '';
    let commodityBefore = '';
    let commodityAfter = '';

    if (commodity?.format) {
      if (commodity.format.symbolOnLeft) {
        commodityBefore = commoditySymbol;
      } else {
        commodityAfter = commoditySymbol;
      }
    } else if (commoditySymbol) {
      // Default heuristic: currencies go on left
      const leftSymbols = ['$', '€', '£', '¥'];
      if (leftSymbols.includes(commoditySymbol)) {
        commodityBefore = commoditySymbol;
      } else {
        commodityAfter = commoditySymbol;
      }
    }

    return {
      commodityBefore,
      amountNumber,
      commodityAfter,
      decimalPosition: isNegative ? decimalPosition + 1 : decimalPosition // Adjust for minus sign
    };
  }

  /**
   * Parse a cost into its components for formatting
   */
  private parseCost(cost: { type: 'unit' | 'total'; amount: Amount }, parsed: ParsedDocument): ParsedCost {
    const parsedAmount = this.parseAmount(cost.amount, parsed);

    return {
      type: cost.type,
      commodityBefore: parsedAmount.commodityBefore,
      amountNumber: parsedAmount.amountNumber,
      commodityAfter: parsedAmount.commodityAfter,
      decimalPosition: parsedAmount.decimalPosition
    };
  }

  /**
   * Format all postings in a transaction with column alignment
   */
  private formatTransactionPostings(
    layouts: PostingLayout[],
    options: Required<FormattingOptions>
  ): string[] {
    if (layouts.length === 0) {
      return [];
    }

    // Calculate column widths for this transaction
    let maxAccountLen = 0;
    let maxCommodityBeforeLen = 0;
    let maxCommodityAfterLen = 0;
    let maxAssertionCommodityBeforeLen = 0;
    let maxAssertionCommodityAfterLen = 0;

    for (const layout of layouts) {
      maxAccountLen = Math.max(maxAccountLen, layout.account.length);

      if (layout.parsedAmount) {
        maxCommodityBeforeLen = Math.max(maxCommodityBeforeLen, layout.parsedAmount.commodityBefore.length);
        maxCommodityAfterLen = Math.max(maxCommodityAfterLen, layout.parsedAmount.commodityAfter.length);
      }

      if (layout.parsedAssertion) {
        maxAssertionCommodityBeforeLen = Math.max(maxAssertionCommodityBeforeLen, layout.parsedAssertion.commodityBefore.length);
        maxAssertionCommodityAfterLen = Math.max(maxAssertionCommodityAfterLen, layout.parsedAssertion.commodityAfter.length);
      }
    }

    // Apply maximum constraints
    maxAccountLen = Math.min(maxAccountLen, options.maxAccountWidth);
    maxCommodityBeforeLen = Math.min(maxCommodityBeforeLen, options.maxCommodityWidth);
    maxCommodityAfterLen = Math.min(maxCommodityAfterLen, options.maxCommodityWidth);
    maxAssertionCommodityBeforeLen = Math.min(maxAssertionCommodityBeforeLen, options.maxCommodityWidth);
    maxAssertionCommodityAfterLen = Math.min(maxAssertionCommodityAfterLen, options.maxCommodityWidth);

    // Format each posting
    return layouts.map(layout => {
      let result = layout.indent + layout.account;

      // If no amount, just return account with comment if any
      if (!layout.parsedAmount) {
        if (layout.comment) {
          result += '  ;' + layout.comment;
        }
        return result;
      }

      // Calculate spacing to reach decimal align column
      const accountEnd = layout.indent.length + layout.account.length;

      // Target position for the decimal point
      let decimalTargetCol = options.decimalAlignColumn;

      // Calculate where amount needs to start to align decimal at target
      const amountStartCol = decimalTargetCol - layout.parsedAmount.decimalPosition;

      // Calculate where commodity-before needs to start (right-aligned before amount)
      const commodityBeforeStartCol = amountStartCol - (layout.parsedAmount.commodityBefore.length > 0 ? layout.parsedAmount.commodityBefore.length : 0);

      // Calculate spacing needed after account
      let spacingAfterAccount = commodityBeforeStartCol - accountEnd;

      // Ensure minimum spacing
      if (spacingAfterAccount < options.minSpacing) {
        spacingAfterAccount = options.minSpacing;
      }

      // Add spacing
      result += ' '.repeat(spacingAfterAccount);

      // Add commodity-before (right-aligned in its column)
      if (layout.parsedAmount.commodityBefore) {
        result += layout.parsedAmount.commodityBefore;
      }

      // Add amount
      result += layout.parsedAmount.amountNumber;

      // Add commodity-after (left-aligned in its column)
      if (layout.parsedAmount.commodityAfter) {
        result += ' ' + layout.parsedAmount.commodityAfter;
      }

      // Add cost notation if present
      if (layout.parsedCost) {
        // Add @ or @@ operator
        result += layout.parsedCost.type === 'unit' ? ' @ ' : ' @@ ';

        // Add cost commodity-before
        if (layout.parsedCost.commodityBefore) {
          result += layout.parsedCost.commodityBefore;
        }

        // Add cost amount
        result += layout.parsedCost.amountNumber;

        // Add cost commodity-after
        if (layout.parsedCost.commodityAfter) {
          result += ' ' + layout.parsedCost.commodityAfter;
        }
      }

      // Add balance assertion if present
      if (layout.parsedAssertion) {
        result += ' = ';

        // Add assertion commodity-before
        if (layout.parsedAssertion.commodityBefore) {
          result += layout.parsedAssertion.commodityBefore;
        }

        // Add assertion amount
        result += layout.parsedAssertion.amountNumber;

        // Add assertion commodity-after
        if (layout.parsedAssertion.commodityAfter) {
          result += ' ' + layout.parsedAssertion.commodityAfter;
        }
      }

      // Add comment if present
      if (layout.comment) {
        result += '  ;' + layout.comment;
      }

      return result;
    });
  }

  /**
   * Get the number of decimal places in a number
   */
  private getDecimalPlaces(value: number): number {
    const str = value.toString();
    const decimalIndex = str.indexOf('.');
    if (decimalIndex === -1) {
      return 0;
    }
    return str.length - decimalIndex - 1;
  }

  /**
   * Find the commodity format from parsed document
   */
  private findCommodity(commodityName: string, parsed: ParsedDocument): Commodity | undefined {
    return parsed.commodities.find(c => c.name === commodityName);
  }
}

export const formattingProvider = new FormattingProvider();
