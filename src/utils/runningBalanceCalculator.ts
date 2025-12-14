/**
 * Running balance calculator for hledger transactions
 *
 * Calculates running balances for all accounts across all transactions,
 * taking into account:
 * - Chronological ordering (by date)
 * - Multiple commodities per account
 * - Explicit and inferred amounts
 * - Transactions from multiple files (via includes)
 */

import { Transaction, ParsedDocument } from '../types';

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
 * 1. Sorts transactions chronologically by date
 * 2. Processes each posting to update account balances
 * 3. Returns a map of balances after each posting
 *
 * @param parsed The parsed document containing all transactions
 * @returns A map of transaction index -> posting index -> commodity -> balance
 */
export function calculateRunningBalances(parsed: ParsedDocument): RunningBalanceMap {
  const result: RunningBalanceMap = new Map();

  // Track global account balances across all transactions
  const accountBalances: AccountBalanceMap = new Map();

  // Sort transactions by date to calculate balances in chronological order
  // This is critical when transactions come from multiple files via includes
  const sortedTransactions = [...parsed.transactions].sort((a, b) => {
    return a.date.localeCompare(b.date);
  });

  // Create a map from sorted index to original index
  const sortedToOriginalIndex = new Map<number, number>();
  sortedTransactions.forEach((tx, sortedIdx) => {
    const originalIdx = parsed.transactions.indexOf(tx);
    sortedToOriginalIndex.set(sortedIdx, originalIdx);
  });

  for (let sortedIdx = 0; sortedIdx < sortedTransactions.length; sortedIdx++) {
    const transaction = sortedTransactions[sortedIdx];
    const txIndex = sortedToOriginalIndex.get(sortedIdx)!;
    const postingBalances = new Map<number, Map<string, number>>();

    // Get inferred amounts from the transaction's AST (if available)
    const inferredAmounts = getInferredAmountsFromTransaction(transaction);

    for (let postingIndex = 0; postingIndex < transaction.postings.length; postingIndex++) {
      const posting = transaction.postings[postingIndex];
      const account = posting.account;

      // Get amount (either explicit or inferred)
      let amountMap: Map<string, number> | undefined;

      if (posting.amount) {
        // Explicit amount
        const commodity = posting.amount.commodity || '';
        amountMap = new Map([[commodity, posting.amount.quantity]]);
      } else {
        // Inferred amount
        amountMap = inferredAmounts.get(postingIndex);
      }

      if (amountMap) {
        // Update balance for each commodity in this posting
        for (const [commodity, quantity] of amountMap.entries()) {
          // Get or create account balance map
          if (!accountBalances.has(account)) {
            accountBalances.set(account, new Map<string, number>());
          }
          const commodityBalances = accountBalances.get(account)!;

          // Update balance
          const currentBalance = commodityBalances.get(commodity) || 0;
          const newBalance = currentBalance + quantity;
          commodityBalances.set(commodity, newBalance);

          // Store this posting's resulting balance
          if (!postingBalances.has(postingIndex)) {
            postingBalances.set(postingIndex, new Map());
          }
          postingBalances.get(postingIndex)!.set(commodity, newBalance);
        }
      }
    }

    result.set(txIndex, postingBalances);
  }

  return result;
}

/**
 * Calculate running balances for balance assertion validation
 *
 * This is a simplified version that only tracks account balances,
 * suitable for validating balance assertions.
 *
 * @param transactions List of transactions (will be sorted by date internally)
 * @returns A map of account name -> commodity -> balance
 */
export function calculateAccountBalances(transactions: Transaction[]): AccountBalanceMap {
  const balances: AccountBalanceMap = new Map();

  // Sort transactions by date to calculate balances in chronological order
  const sortedTransactions = [...transactions].sort((a, b) => {
    return a.date.localeCompare(b.date);
  });

  for (const transaction of sortedTransactions) {
    for (const posting of transaction.postings) {
      // Update running balance
      // Note: Balance assertions check the ORIGINAL commodity (amount.commodity),
      // not the cost commodity. So we always update balance in the amount's commodity.
      if (posting.amount) {
        const accountBalances = balances.get(posting.account) || new Map<string, number>();
        const commodity = posting.amount.commodity || '';
        const currentBalance = accountBalances.get(commodity) || 0;
        // Always use the original amount quantity for balance tracking,
        // regardless of whether there's a cost notation
        accountBalances.set(commodity, currentBalance + posting.amount.quantity);
        balances.set(posting.account, accountBalances);
      }
    }
  }

  return balances;
}

/**
 * Get inferred amounts from a transaction
 *
 * This extracts inferred amounts that were calculated during parsing
 * and stored in the transaction's AST.
 *
 * @param transaction The transaction to extract inferred amounts from
 * @returns A map of posting index -> commodity -> amount
 */
function getInferredAmountsFromTransaction(transaction: Transaction): Map<number, Map<string, number>> {
  const result = new Map<number, Map<string, number>>();

  // If the transaction has an AST with inferred amounts, use those
  if ((transaction as any).ast) {
    const ast = (transaction as any).ast;

    // Look for inferred amounts in the AST
    // The AST should have calculated these during parsing
    if (ast.inferredAmounts) {
      return ast.inferredAmounts;
    }
  }

  // If no AST or no inferred amounts, calculate them manually
  // This is a fallback for transactions without AST data
  const explicitPostings = transaction.postings.filter(p => p.amount && !p.amount.inferred);
  const implicitPostings = transaction.postings.filter(p => !p.amount || p.amount.inferred);

  if (implicitPostings.length === 1 && explicitPostings.length > 0) {
    // Calculate the inferred amount as the negative sum of explicit amounts
    const sums = new Map<string, number>();

    for (const posting of explicitPostings) {
      if (posting.amount) {
        const commodity = posting.amount.commodity || '';
        const currentSum = sums.get(commodity) || 0;
        sums.set(commodity, currentSum + posting.amount.quantity);
      }
    }

    // Negate the sums to get the inferred amount
    const inferredAmountMap = new Map<string, number>();
    for (const [commodity, sum] of sums.entries()) {
      inferredAmountMap.set(commodity, -sum);
    }

    // Find the index of the implicit posting
    const implicitIndex = transaction.postings.indexOf(implicitPostings[0]);
    result.set(implicitIndex, inferredAmountMap);
  }

  return result;
}
