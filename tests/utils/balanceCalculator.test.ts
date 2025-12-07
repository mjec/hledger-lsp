import {
    calculateTransactionBalance,
    calculateTransactionBalanceSimple,
    addPostingToBalance
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

    describe('addPostingToBalance', () => {
        test('should add simple posting to balance', () => {
            const balances = new Map<string, number>();
            addPostingToBalance(balances, createPosting(100, 'USD'));

            expect(balances.get('USD')).toBe(100);

            addPostingToBalance(balances, createPosting(50, 'USD'));
            expect(balances.get('USD')).toBe(150);
        });

        test('should handle unit cost conversion', () => {
            const balances = new Map<string, number>();
            // 10 AAPL @ 150 USD
            addPostingToBalance(balances, createPostingWithCost(10, 'AAPL', 150, 'USD', 'unit'));

            expect(balances.get('USD')).toBe(1500);
            expect(balances.has('AAPL')).toBe(false);
        });

        test('should handle total cost conversion', () => {
            const balances = new Map<string, number>();
            // 10 AAPL @@ 1500 USD
            addPostingToBalance(balances, createPostingWithCost(10, 'AAPL', 1500, 'USD', 'total'));

            expect(balances.get('USD')).toBe(1500);
        });

        test('should handle missing commodities', () => {
            const balances = new Map<string, number>();
            const posting = createPosting(100, '');
            addPostingToBalance(balances, posting);
            expect(balances.get('')).toBe(100);
        });

        test('should handle missing cost commodities', () => {
            const balances = new Map<string, number>();
            const posting = createPostingWithCost(10, 'AAPL', 150, '', 'unit');
            addPostingToBalance(balances, posting);
            expect(balances.get('')).toBe(1500);
        });
    });
});
