import {
  calculateTransactionBalance,
  calculateTransactionBalanceSimple,
} from '../../src/utils/balanceCalculator';
import { Transaction, Posting } from '../../src/types';

describe('balanceCalculator', () => {
  // Helper to create a simple posting
  const createPosting = (quantity: number, commodity: string): Posting => ({
    account: 'assets:bank',
    amount: { quantity, commodity }
  });

  // Helper to create a posting with cost
  const createPostingWithCost = (
    quantity: number,
    commodity: string,
    costQuantity: number,
    costCommodity: string,
    type: 'unit' | 'total'
  ): Posting => ({
    account: 'assets:bank',
    amount: { quantity, commodity },
    cost: {
      amount: { quantity: costQuantity, commodity: costCommodity },
      type
    }
  });

  describe('calculateTransactionBalance', () => {
    test('should calculate balance for simple postings', () => {
      const transaction: Transaction = {
        date: '2024-01-01',
        description: 'Test',
        payee: 'Test Payee',
        note: '',
        postings: [
          createPosting(100, 'USD'),
          createPosting(-100, 'USD')
        ]
      };

      const balance = calculateTransactionBalance(transaction);
      expect(balance.get('USD')).toBe(0);
    });

    test('should handle mixed commodities', () => {
      const transaction: Transaction = {
        date: '2024-01-01',
        description: 'Test',
        payee: 'Test Payee',
        note: '',
        postings: [
          createPosting(100, 'USD'),
          createPosting(-80, 'EUR'),
          createPosting(-20, 'USD')
        ]
      };

      const balance = calculateTransactionBalance(transaction);
      expect(balance.get('USD')).toBe(80);
      expect(balance.get('EUR')).toBe(-80);
    });

    test('should handle unit cost conversions (@)', () => {
      // 10 AAPL @ 150 USD = 1500 USD cost
      const transaction: Transaction = {
        date: '2024-01-01',
        description: 'Investment',
        payee: 'Broker',
        note: '',
        postings: [
          createPostingWithCost(10, 'AAPL', 150, 'USD', 'unit'),
          createPosting(-1500, 'USD')
        ]
      };

      const balance = calculateTransactionBalance(transaction);
      // The AAPL posting contributes 1500 USD to the balance because of the cost
      // The USD posting contributes -1500 USD
      // Net USD balance should be 0
      expect(balance.get('USD')).toBe(0);
      // AAPL is not in the balance map because it was converted to cost commodity
      expect(balance.has('AAPL')).toBe(false);
    });

    test('should handle total cost conversions (@@)', () => {
      // 10 AAPL @@ 1500 USD = 1500 USD cost
      const transaction: Transaction = {
        date: '2024-01-01',
        description: 'Investment',
        payee: 'Broker',
        note: '',
        postings: [
          createPostingWithCost(10, 'AAPL', 1500, 'USD', 'total'),
          createPosting(-1500, 'USD')
        ]
      };

      const balance = calculateTransactionBalance(transaction);
      expect(balance.get('USD')).toBe(0);
    });

    test('should inherit sign from posting amount for @@ total cost (negative amount, positive cost)', () => {
      // -10 FUND @@ 1000 USD should contribute -1000 USD (sign from amount)
      const transaction: Transaction = {
        date: '2024-01-01',
        description: 'Opening balances',
        payee: 'Opening balances',
        note: '',
        postings: [
          createPostingWithCost(10, 'FUND', 1000, 'USD', 'total'),
          createPostingWithCost(-10, 'FUND', 1000, 'USD', 'total'),
        ]
      };

      const balance = calculateTransactionBalance(transaction);
      expect(balance.get('USD')).toBe(0);
    });

    test('should detect unbalanced @@ when amount and cost signs differ (double negative)', () => {
      // 10 FUND @@ 1000 USD → sign(10) * 1000 = +1000 USD
      // -10 FUND @@ -1000 USD → sign(-10) * -1000 = +1000 USD
      // Both contribute +1000, so unbalanced (net +2000)
      const transaction: Transaction = {
        date: '2024-01-01',
        description: 'Opening balances',
        payee: 'Opening balances',
        note: '',
        postings: [
          createPostingWithCost(10, 'FUND', 1000, 'USD', 'total'),
          createPostingWithCost(-10, 'FUND', -1000, 'USD', 'total'),
        ]
      };

      const balance = calculateTransactionBalance(transaction);
      expect(balance.get('USD')).toBe(2000);
    });
  });

  describe('calculateTransactionBalanceSimple', () => {
    test('should sum quantities by commodity ignoring cost', () => {
      const transaction: Transaction = {
        date: '2024-01-01',
        description: 'Test',
        payee: 'Test Payee',
        note: '',
        postings: [
          createPosting(100, 'USD'),
          createPostingWithCost(10, 'AAPL', 150, 'USD', 'unit')
        ]
      };

      const totals = calculateTransactionBalanceSimple(transaction);
      expect(totals['USD']).toBe(100);
      expect(totals['AAPL']).toBe(10);
    });
  });

});
