/**
 * Utilities for calculating transaction balances
 */

import { Amount, Posting, Transaction } from '../types';

/**
 * Number of decimal places an amount was written with.
 * The parser records this in format.precision; no decimal mark means 0.
 */
export function amountPrecision(amount: Amount): number {
  return amount.format?.precision ?? 0;
}

// Beyond ~10 decimal places, float64 arithmetic noise approaches the
// half-ULP tolerance itself, so we stop tightening the comparison there.
const MAX_COMPARISON_PRECISION = 10;

/**
 * Comparison tolerance for balance checks at a given decimal precision.
 *
 * hledger balances a transaction iff the residue rounds to zero at the
 * commodity's precision, i.e. |residue| <= 0.5 * 10^-p (half a unit in the
 * last place). A small constant absorbs binary floating-point noise.
 */
export function balanceTolerance(precision: number): number {
  const p = Math.min(precision, MAX_COMPARISON_PRECISION);
  return 0.5 * Math.pow(10, -p) + 1e-10;
}

/**
 * Max decimal precision per commodity across a transaction's postings, as used for
 * balance checking. Transaction-local, mirroring hledger: journal-wide or declared
 * commodity precision does not affect balancing.
 *
 * A commodity's precision comes from the amounts *postings* state in it. The
 * precision of a **cost** is deliberately not counted: writing a rate to more
 * decimal places than the amounts it converts must not tighten the tolerance.
 * hledger accepts `1C @ $1.0049` against `$-1.00` — a $0.0049 residue, inside half
 * a unit of the posting's 2 places — but rejects the same residue against
 * `$-1.0000`. A cost is consulted only for a commodity that no posting states,
 * which otherwise would have no precision at all.
 */
export function commodityPrecisions(postings: Posting[]): Map<string, number> {
  const fromPostings = new Map<string, number>();
  const fromCosts = new Map<string, number>();

  const bump = (into: Map<string, number>, commodity: string, p: number) => {
    const current = into.get(commodity);
    if (current === undefined || p > current) {
      into.set(commodity, p);
    }
  };

  for (const posting of postings) {
    if (posting.virtual === 'unbalanced' || !posting.amount) continue;
    if (posting.cost) {
      bump(fromCosts, posting.cost.amount.commodity || '', amountPrecision(posting.cost.amount));
    } else {
      bump(fromPostings, posting.amount.commodity || '', amountPrecision(posting.amount));
    }
  }

  const precisions = new Map(fromPostings);
  for (const [commodity, precision] of fromCosts.entries()) {
    if (!precisions.has(commodity)) {
      precisions.set(commodity, precision);
    }
  }

  return precisions;
}

// hledger's default conversion (equity) account names. A posting to one of these
// accounts, or any subaccount, records one side of a currency conversion.
const CONVERSION_ACCOUNTS = ['equity:conversion', 'equity:trade', 'equity:trading'];

/**
 * Whether an account records one side of a currency conversion.
 *
 * Matches hledger's built-in names case-insensitively, including subaccounts.
 * Note that accounts declared `type:V` are also conversion accounts in hledger;
 * the parser does not yet record account types, so those are not detected here.
 */
export function isConversionAccount(account: string): boolean {
  const name = account.toLowerCase();
  return CONVERSION_ACCOUNTS.some(base => name === base || name.startsWith(`${base}:`));
}

/**
 * Calculate transaction balance grouped by commodity, handling cost conversions
 *
 * When a posting has a cost (@ or @@), the cost commodity is used for balance
 * calculation instead of the posting's commodity.
 *
 * A pair of conversion postings already records both sides of an exchange, so
 * each commodity balances on its own. When such postings are present, any cost
 * is redundant documentation of the same exchange, and applying it as well would
 * count the conversion twice — so costs are ignored. hledger additionally rejects
 * a cost that contradicts the conversion postings; that consistency check is not
 * implemented here.
 *
 * @param transaction - The transaction to calculate balance for
 * @returns Map of commodity to total amount
 */
export function calculateTransactionBalance(transaction: Transaction): Map<string, number> {
  const balances = new Map<string, number>();
  const hasConversionPostings = transaction.postings.some(p => isConversionAccount(p.account));

  for (const posting of transaction.postings) {
    // Unbalanced virtual postings () don't participate in balance checks
    if (posting.virtual === 'unbalanced') continue;

    if (posting.amount) {
      // If posting has a cost, use the cost commodity for balance calculation
      if (posting.cost && !hasConversionPostings) {
        const costCommodity = posting.cost.amount.commodity || '';
        let costValue: number;

        if (posting.cost.type === 'unit') {
          // @ unitPrice: total cost = quantity * unitPrice
          costValue = posting.amount.quantity * posting.cost.amount.quantity;
        } else if (posting.cost.inferred) {
          // @@ totalPrice (inferred): sign is already correct from inferCosts()
          costValue = posting.cost.amount.quantity;
        } else {
          // @@ totalPrice (explicit): sign comes from the posting amount
          // e.g. -10 FUND @@ 1000 USD → -1000 USD, -10 FUND @@ -1000 USD → +1000 USD
          costValue = Math.sign(posting.amount.quantity) * posting.cost.amount.quantity;
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

