/**
 * Utilities for formatting amounts with proper commodity placement
 */

import { ParsedDocument } from '../types';

/**
 * Format an amount with proper commodity placement based on commodity format info
 *
 * @param quantity - The numeric amount
 * @param commodity - The commodity symbol/name
 * @param parsed - ParsedDocument to look up commodity format information
 * @returns Formatted amount string (e.g., "$50.00", "50.00 USD")
 */
import { HledgerSettings } from '../server/settings';

// Type alias to avoid circular dependency issues if HledgerSettings imports from elsewhere
type FormattingOptions = HledgerSettings['formatting'];

/**
 * Format an amount with proper commodity placement based on commodity format info
 *
 * @param quantity - The numeric amount
 * @param commodity - The commodity symbol/name
 * @param parsed - ParsedDocument to look up commodity format information
 * @param options - Formatting options (e.g. sign position)
 * @returns Formatted amount string (e.g., "$50.00", "50.00 USD")
 */
export function formatAmount(quantity: number, commodity: string, parsed: ParsedDocument, options?: FormattingOptions): string {
  // Handle negative amounts by extracting the sign
  const absQuantity = Math.abs(quantity);
  const sign = quantity < 0 ? '-' : '';

  // Find commodity format if available
  const commodityInfo = parsed.commodities.get(commodity);

  if (commodityInfo?.format) {
    // Use declared commodity format
    const format = commodityInfo.format;
    const symbol = format.symbol || commodity;
    const symbolOnLeft = format.symbolOnLeft ?? false;
    const spaceBetween = format.spaceBetween ?? true;
    const space = spaceBetween ? ' ' : '';

    // Use precision from format, or default to 2
    const precision = format.precision ?? 2;

    // Manual formatting to respect separators
    const decimalMark = format.decimalMark || '.';
    const thousandsSeparator = format.thousandsSeparator; // can be null/undefined

    // Get basic fixed string (e.g. "1000.00") with dot decimal
    const baseFixed = absQuantity.toFixed(precision);
    const [integerPart, decimalPart] = baseFixed.split('.');

    let formattedInteger = integerPart;
    if (thousandsSeparator) {
      // split into groups of 3
      const groups = [];
      for (let i = integerPart.length; i > 0; i -= 3) {
        groups.unshift(integerPart.substring(Math.max(0, i - 3), i));
      }
      formattedInteger = groups.join(thousandsSeparator);
    }

    const formattedNumber = decimalPart ? `${formattedInteger}${decimalMark}${decimalPart}` : formattedInteger;

    if (symbolOnLeft) {
      if (quantity < 0) {
        // Handle negative sign position
        const signPos = options?.signPosition || 'after-symbol';
        if (signPos === 'before-symbol') { // -$100
          return `${sign}${symbol}${space}${formattedNumber}`;
        } else { // $-100 (default)
          return `${symbol}${sign}${space}${formattedNumber}`;
        }
      }
      return `${sign}${symbol}${space}${formattedNumber}`;
    } else {
      return `${sign}${formattedNumber}${space}${symbol}`;
    }
  } else if (commodity) {
    // No format declared, use default heuristic
    // Common currencies go on left without space, others go on right with space
    const leftSymbols = ['$', '€', '£', '¥'];
    const precision = 2; // Default precision
    const formattedNumber = absQuantity.toFixed(precision);

    if (leftSymbols.includes(commodity)) {
      if (quantity < 0) {
        const signPos = options?.signPosition || 'after-symbol';
        if (signPos === 'before-symbol') {
          return sign + commodity + formattedNumber;
        } else {
          return commodity + sign + formattedNumber;
        }
      }
      return sign + commodity + formattedNumber;
    } else {
      return sign + formattedNumber + ' ' + commodity;
    }
  } else {
    // No commodity
    return quantity.toFixed(2);
  }
}
