/**
 * Utilities for calculating transaction balances
 */

import { Transaction } from '../types';

/**
 * Calculate transaction balance grouped by commodity, handling cost conversions
 *
 * When a posting has a cost (@ or @@), the cost commodity is used for balance
 * calculation instead of the posting's commodity.
 *
 * @param transaction - The transaction to calculate balance for
 * @returns Map of commodity to total amount
 */
export function calculateTransactionBalance(transaction: Transaction): Map<string, number> {
  const balances = new Map<string, number>();

  for (const posting of transaction.postings) {
    if (posting.amount) {
      // If posting has a cost, use the cost commodity for balance calculation
      if (posting.cost) {
        const costCommodity = posting.cost.amount.commodity || '';
        let costValue: number;

        if (posting.cost.type === 'unit') {
          // @ unitPrice: total cost = quantity * unitPrice
          costValue = posting.amount.quantity * posting.cost.amount.quantity;
        } else {
          // @@ totalPrice: use total price directly
          costValue = posting.cost.amount.quantity;
        }

        const current = balances.get(costCommodity) || 0;
        balances.set(costCommodity, current + costValue);
      } else {
        // No cost notation, use the posting's commodity
        const commodity = posting.amount.commodity || '';
        const current = balances.get(commodity) || 0;
        balances.set(commodity, current + posting.amount.quantity);
      }
    }
  }

  return balances;
}

/**
 * Calculate transaction balance grouped by commodity (simple version, no cost handling)
 *
 * This version doesn't handle cost conversions and is useful when you only need
 * the balance in the original posting commodities. Excludes inferred amounts.
 *
 * @param transaction - The transaction to calculate balance for
 * @returns Record of commodity to total amount (excluding inferred amounts)
 */
export function calculateTransactionBalanceSimple(transaction: Transaction): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const posting of transaction.postings) {
    // Only include explicit (non-inferred) amounts for display purposes
    if (posting.amount && !posting.amount.inferred) {
      const commodity = posting.amount.commodity || '';
      totals[commodity] = (totals[commodity] || 0) + posting.amount.quantity;
    }
  }

  return totals;
}

