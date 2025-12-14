/**
 * Utilities for formatting amounts with proper commodity placement
 */

import { ParsedDocument, Amount, Format } from '../types';
import { HledgerSettings } from '../server/settings';

// Type alias to avoid circular dependency issues if HledgerSettings imports from elsewhere
export type FormattingOptions = HledgerSettings['formatting'];

export interface AmountLayout {
  commodityBefore: string;
  isNegative: boolean;
  negativeSignBefore: boolean;  // true if sign should be before commodity
  amountIntegerString: string;
  amountDecimalString: string;
  demicalMark: string;
  commodityAfter: string;
  spaceBetweenCommodityAndAmount: boolean;
}

/**
 * Format an amount with proper commodity placement based on commodity format info
 *
 * @param quantity - The numeric amount
 * @param commodity - The commodity symbol/name
 * @param parsed - ParsedDocument to look up commodity format information
 * @param options - Formatting options (e.g. sign position)
 * @returns Formatted amount string (e.g., "$50.00", "50.00 USD")
 */
export interface AmountWidths {
  commodityBefore: number;
  spaceBetweenCommodityBeforeAndAmount: number;
  negativeSign: number;
  integer: number;
  decimalMark: number;
  decimal: number;
  spaceBetweenAmountAndCommodityAfter: number;
  commodityAfter: number;
}

export function formatAmount(quantity: number, commodity: string, parsed: ParsedDocument, options?: FormattingOptions): string {
  // Construct a temporary Amount object to reuse the unified layout logic
  const amount: Amount = {
    quantity,
    commodity
    // We don't have the full amount object with format/source here, but that's fine for this use case
    // format property is undefined, so it will fall back to commodity format
  };

  // Safe defaults for options if not provided
  const opts: Required<FormattingOptions> = {
    indentation: 4,
    maxAccountWidth: 42,
    maxCommodityWidth: 4,
    maxAmountWidth: 12,
    minSpacing: 2,
    decimalAlignColumn: 52,
    assertionDecimalAlignColumn: 70,
    signPosition: 'after-symbol',
    ...options
  };

  const layout = getAmountLayout(amount, parsed, opts);
  return renderAmountLayout(layout);
}

/**
 * Calculate the layout components for an amount
 */
export function getAmountLayout(amount: Amount, parsed: ParsedDocument, options: Required<FormattingOptions>): AmountLayout {
  const commodity = parsed.commodities.get(amount.commodity);
  let format: Format = {};
  let declaredPrecision: number | undefined = undefined;

  if (commodity && commodity.format) {
    format = commodity.format;
    const formatPrecision = commodity.format.precision;
    // Note: precision can be undefined (not set), null (no decimal), or a number
    // Only set declaredPrecision if it's a number
    if (formatPrecision !== null && formatPrecision !== undefined) {
      declaredPrecision = formatPrecision;
    }
  } else if (amount.format) {
    format = amount.format;
  } else {
    // If no format found, check some defaults or use empty
    if (!commodity && !amount.format) {
      // Default for any undeclared commodity: Symbol on left, no space, precision 2
      if (amount.commodity) {
        format = {
          symbolOnLeft: true,
          spaceBetween: false,
          symbol: amount.commodity,
          precision: 2
        }
        declaredPrecision = 2;
      }

    }
  }

  // Determine the actual precision to use based on the rules:
  // 1. Never reduce precision if posting has higher precision than declared
  // 2. Add zeros to match declared precision when actual < declared
  // 3. Don't change formatting when commodity is not declared
  // Note: precision can be undefined (not set), null (no decimal), or a number
  const amountFormatPrecision = amount.format?.precision;
  const actualPrecision = (amountFormatPrecision !== null && amountFormatPrecision !== undefined) ? amountFormatPrecision : undefined;
  let targetPrecision: number | undefined = undefined;

  if (declaredPrecision !== undefined) {
    // Commodity is declared - use max of actual and declared precision
    if (actualPrecision !== undefined) {
      targetPrecision = Math.max(actualPrecision, declaredPrecision);
    } else if (amountFormatPrecision === null && commodity?.declared !== true) {
      // Amount has explicit null precision (no decimal) - preserve it
      // UNLESS the commodity is declared (via commodity directive), in which case use declared precision
      targetPrecision = undefined;
    } else {
      targetPrecision = declaredPrecision;
    }
  } else {
    // Commodity is not declared - preserve original precision
    targetPrecision = actualPrecision;

    // Fallback for formatAmount heuristic cases (e.g. "123.456" with no commodity)
    if (targetPrecision === undefined && !amount.format && !commodity?.format) {
      if (!amount.commodity) {
        targetPrecision = 2;
      }
    }
  }

  const symbolOnLeft = format.symbolOnLeft || false;
  // Fallback for spaceBetween: default to true for right-side symbols (most commodities), false for left-side ($)
  const spaceBetweenCommodityAndAmount = format.spaceBetween ?? (symbolOnLeft ? false : true);
  const negativeSignBefore = symbolOnLeft && options?.signPosition === 'before-symbol';

  // Calculate string values using rounding logic
  const absQuantity = Math.abs(amount.quantity);
  const rawString = targetPrecision !== undefined ? absQuantity.toFixed(targetPrecision) : absQuantity.toString();
  const parts = rawString.split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1] || '';

  // Format Integer
  let amountIntegerString = integerPart;
  if (format.thousandsSeparator) {
    const regex = /\B(?=(\d{3})+(?!\d))/g;
    amountIntegerString = integerPart.replace(regex, format.thousandsSeparator);
  }

  // Format Decimal
  // decimalPart is already correct from toFixed or toString
  const amountDecimalString = decimalPart;

  return {
    commodityBefore: symbolOnLeft ? format?.symbol || amount.commodity || '' : '',
    isNegative: amount.quantity < 0,
    negativeSignBefore,
    amountIntegerString,
    amountDecimalString,
    demicalMark: (targetPrecision !== undefined && targetPrecision > 0) || amountDecimalString.length > 0 ? (format.decimalMark || '.') : '',
    spaceBetweenCommodityAndAmount,
    commodityAfter: !symbolOnLeft ? format?.symbol || amount.commodity || '' : ''
  };
}

/**
 * Render the layout into a string, optionally using provided widths for alignment/padding.
 * If widths are not provided, segments are joined without extra padding.
 */
export function renderAmountLayout(layout: AmountLayout, widths?: AmountWidths): string {
  // If no widths provided, create minimal widths based on content
  const effectiveWidths: AmountWidths = widths || {
    commodityBefore: layout.commodityBefore.length,
    spaceBetweenCommodityBeforeAndAmount: (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore) ? 1 : 0,
    negativeSign: layout.isNegative ? 1 : 0,
    integer: layout.amountIntegerString.length,
    decimalMark: layout.demicalMark.length,
    decimal: layout.amountDecimalString.length,
    spaceBetweenAmountAndCommodityAfter: (layout.spaceBetweenCommodityAndAmount && layout.commodityAfter) ? 1 : 0,
    commodityAfter: layout.commodityAfter.length
  };

  let result = '';

  if (layout.negativeSignBefore) {
    result += layout.isNegative ? '-'.padStart(effectiveWidths.negativeSign, ' ') : ' '.repeat(effectiveWidths.negativeSign);
    result += layout.commodityBefore.padStart(effectiveWidths.commodityBefore, ' ');
  } else {
    result += layout.commodityBefore.padStart(effectiveWidths.commodityBefore, ' ');
    result += layout.isNegative ? '-'.padStart(effectiveWidths.negativeSign, ' ') : ' '.repeat(effectiveWidths.negativeSign);
  }

  result += ' '.repeat(effectiveWidths.spaceBetweenCommodityBeforeAndAmount);
  result += layout.amountIntegerString.padStart(effectiveWidths.integer, ' ');

  if (layout.demicalMark) {
    result += layout.demicalMark.padEnd(effectiveWidths.decimalMark, ' ');
    result += layout.amountDecimalString.padEnd(effectiveWidths.decimal, ' ');
  } else {
    // If there is no decimal mark in this specific amount, we still need to respect
    // the reserved space for alignment if it exists.
    result += ' '.repeat(effectiveWidths.decimalMark + effectiveWidths.decimal);
  }

  result += ' '.repeat(effectiveWidths.spaceBetweenAmountAndCommodityAfter);
  result += layout.commodityAfter.padEnd(effectiveWidths.commodityAfter, ' ');

  return result;
}

