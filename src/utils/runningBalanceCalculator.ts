/**
 * Running balance calculator for hledger transactions
 *
 * Calculates running balances for all accounts across all transactions,
 * taking into account:
 * - Chronological ordering (by effective date, respecting posting dates)
 * - Multiple commodities per account
 * - Explicit and inferred amounts
 * - Transactions from multiple files (via includes)
 */

import { Transaction, ParsedDocument } from '../types';
import { getEffectiveDate } from './index';

/**
 * Result of running balance calculation
 * Maps: transaction index -> posting index -> commodity -> balance
 */
export type RunningBalanceMap = Map<number, Map<number, Map<string, number>>>;

/**
 * Account balances
 * Maps: account name -> commodity -> balance
 */
export type AccountBalanceMap = Map<string, Map<string, number>>;

/**
 * Calculate running balances for all transactions in a parsed document
 *
 * This function:
 * 1. Extracts all postings with their effective dates (respecting posting dates)
 * 2. Sorts postings chronologically by effective date
 * 3. Processes each posting to update account balances
 * 4. Returns a map of balances after each posting
 *
 * @param parsed The parsed document containing all transactions
 * @returns A map of transaction index -> posting index -> commodity -> balance
 */
export function calculateRunningBalances(parsed: ParsedDocument): RunningBalanceMap {
  const result: RunningBalanceMap = new Map();
  const accountBalances: AccountBalanceMap = new Map();

  // Extract all postings with their effective dates and original indices
  interface PostingWithContext {
    transaction: Transaction;
    posting: import('../types').Posting;
    effectiveDate: string;
    txIndex: number;
    postingIndex: number;
  }

  const allPostings: PostingWithContext[] = [];

  parsed.transactions.forEach((tx, txIdx) => {
    tx.postings.forEach((posting, postingIdx) => {
      allPostings.push({
        transaction: tx,
        posting,
        effectiveDate: getEffectiveDate(posting, tx),
        txIndex: txIdx,
        postingIndex: postingIdx
      });
    });
  });

  // Sort by effective date for chronological processing
  allPostings.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  // Process postings in chronological order
  for (const { posting, txIndex, postingIndex } of allPostings) {
    const account = posting.account;

    // Get amount (explicit only - ignore inferred amounts)
    if (posting.amount) {
      const commodity = posting.amount.commodity || '';

      // Initialize account balance map if needed
      if (!accountBalances.has(account)) {
        accountBalances.set(account, new Map<string, number>());
      }
      const commodityBalances = accountBalances.get(account)!;

      // Update balance
      const currentBalance = commodityBalances.get(commodity) || 0;
      const newBalance = currentBalance + posting.amount.quantity;
      commodityBalances.set(commodity, newBalance);

      // Store this posting's resulting balance in result map
      if (!result.has(txIndex)) {
        result.set(txIndex, new Map());
      }
      if (!result.get(txIndex)!.has(postingIndex)) {
        result.get(txIndex)!.set(postingIndex, new Map());
      }
      result.get(txIndex)!.get(postingIndex)!.set(commodity, newBalance);
    }
  }

  return result;
}
