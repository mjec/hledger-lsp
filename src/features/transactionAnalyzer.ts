/**
 * Transaction history analyzer for smart completions
 *
 * Analyzes transaction patterns to provide intelligent suggestions:
 * - Payee to account associations
 * - Account usage frequency
 * - Common amounts for payee/account combinations
 */

import { ParsedDocument, Transaction } from '../types';

export interface PayeeAccountPattern {
  account: string;
  frequency: number;
  lastUsed?: Date;
}

export interface AccountFrequency {
  account: string;
  count: number;
  lastUsed?: Date;
}

export interface AmountSuggestion {
  amount: number;
  commodity: string;
  frequency: number;
}

export class TransactionAnalyzer {
  private payeeToAccounts: Map<string, Map<string, number>> = new Map();
  private accountFrequency: Map<string, number> = new Map();
  private payeeAccountAmounts: Map<string, Map<number, number>> = new Map(); // payee:account -> amount -> count

  /**
   * Analyze a parsed document to build pattern maps
   */
  analyze(parsed: ParsedDocument): void {
    // Reset maps
    this.payeeToAccounts.clear();
    this.accountFrequency.clear();
    this.payeeAccountAmounts.clear();

    // Analyze each transaction
    for (const transaction of parsed.transactions) {
      this.analyzeTransaction(transaction);
    }
  }

  /**
   * Analyze a single transaction
   */
  private analyzeTransaction(transaction: Transaction): void {
    const payee = transaction.description;
    if (!payee) return;

    // Track accounts used with this payee
    for (const posting of transaction.postings) {
      const account = posting.account;

      // Update payee-to-account mapping
      if (!this.payeeToAccounts.has(payee)) {
        this.payeeToAccounts.set(payee, new Map());
      }
      const accountMap = this.payeeToAccounts.get(payee)!;
      accountMap.set(account, (accountMap.get(account) || 0) + 1);

      // Update account frequency
      this.accountFrequency.set(account, (this.accountFrequency.get(account) || 0) + 1);

      // Track amounts for this payee/account combination
      if (posting.amount) {
        const key = `${payee}:${account}`;
        if (!this.payeeAccountAmounts.has(key)) {
          this.payeeAccountAmounts.set(key, new Map());
        }
        const amountMap = this.payeeAccountAmounts.get(key)!;
        const amount = posting.amount.quantity;
        amountMap.set(amount, (amountMap.get(amount) || 0) + 1);
      }
    }
  }

  /**
   * Get accounts commonly used with a payee, sorted by frequency
   */
  getAccountsForPayee(payee: string, limit: number = 10): PayeeAccountPattern[] {
    const accountMap = this.payeeToAccounts.get(payee);
    if (!accountMap) return [];

    const patterns: PayeeAccountPattern[] = [];
    for (const [account, frequency] of accountMap.entries()) {
      patterns.push({ account, frequency });
    }

    // Sort by frequency (descending)
    patterns.sort((a, b) => b.frequency - a.frequency);

    return patterns.slice(0, limit);
  }

  /**
   * Get all accounts sorted by usage frequency
   */
  getAccountsByFrequency(limit?: number): AccountFrequency[] {
    const frequencies: AccountFrequency[] = [];
    for (const [account, count] of this.accountFrequency.entries()) {
      frequencies.push({ account, count });
    }

    // Sort by frequency (descending)
    frequencies.sort((a, b) => b.count - a.count);

    return limit ? frequencies.slice(0, limit) : frequencies;
  }

  /**
   * Get common amounts for a payee/account combination
   */
  getAmountSuggestionsForPayeeAccount(
    payee: string,
    account: string,
    commodity: string,
    limit: number = 5
  ): AmountSuggestion[] {
    const key = `${payee}:${account}`;
    const amountMap = this.payeeAccountAmounts.get(key);
    if (!amountMap) return [];

    const suggestions: AmountSuggestion[] = [];
    for (const [amount, frequency] of amountMap.entries()) {
      suggestions.push({ amount, commodity, frequency });
    }

    // Sort by frequency (descending)
    suggestions.sort((a, b) => b.frequency - a.frequency);

    return suggestions.slice(0, limit);
  }

  /**
   * Get the most common payee/account pairs (for general insights)
   */
  getMostCommonPayeeAccountPairs(limit: number = 20): Array<{ payee: string; account: string; frequency: number }> {
    const pairs: Array<{ payee: string; account: string; frequency: number }> = [];

    for (const [payee, accountMap] of this.payeeToAccounts.entries()) {
      for (const [account, frequency] of accountMap.entries()) {
        pairs.push({ payee, account, frequency });
      }
    }

    // Sort by frequency (descending)
    pairs.sort((a, b) => b.frequency - a.frequency);

    return pairs.slice(0, limit);
  }

  /**
   * Check if we have any pattern data
   */
  hasPatterns(): boolean {
    return this.payeeToAccounts.size > 0;
  }
}

export const transactionAnalyzer = new TransactionAnalyzer();
