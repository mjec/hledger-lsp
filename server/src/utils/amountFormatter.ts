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
export function formatAmount(quantity: number, commodity: string, parsed: ParsedDocument): string {
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
    const formattedNumber = absQuantity.toFixed(precision);

    if (symbolOnLeft) {
      return `${sign}${symbol}${space}${formattedNumber}`;
    } else {
      return `${sign}${formattedNumber}${space}${symbol}`;
    }
  } else if (commodity) {
    // No format declared, use default heuristic
    // Common currencies go on left without space, others go on right with space
    const leftSymbols = ['$', '€', '£', '¥'];
    const formattedNumber = absQuantity.toFixed(2);

    if (leftSymbols.includes(commodity)) {
      return sign + commodity + formattedNumber;
    } else {
      return sign + formattedNumber + ' ' + commodity;
    }
  } else {
    // No commodity
    return quantity.toFixed(2);
  }
}
