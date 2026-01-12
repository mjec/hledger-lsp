import { HledgerParser } from '../../src/parser';
import { calculateRunningBalances, calculateAccountBalances } from '../../src/utils/runningBalanceCalculator';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('Running Balance Calculator with Posting Dates', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('calculateRunningBalances', () => {
    test('processes postings in effective date order across transactions', () => {
      const content = `
2024-01-20 Transaction B
    assets:checking  $100
    income:salary

2024-01-15 Transaction A
    expenses:food  $10
    assets:checking  ; date:2024-01-25
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateRunningBalances(parsed);

      // Transaction B (index 0): checking = +$100 at 01-20
      // Transaction A (index 1): checking = +$100 - $10 = $90 at 01-25

      // Balance after tx B posting 0 (checking) should be $100
      const txBChecking = balances.get(0)?.get(0)?.get('$');
      expect(txBChecking).toBe(100);

      // Balance after tx A posting 1 (checking, date:01-25) should be $90
      const txAChecking = balances.get(1)?.get(1)?.get('$');
      expect(txAChecking).toBe(90);
    });

    test('handles posting date before transaction date', () => {
      const content = `
2024-01-20 Late Entry
    expenses:food  $50  ; date:2024-01-15
    assets:cash

2024-01-18 Regular Entry
    assets:checking  $100
    income:salary
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateRunningBalances(parsed);

      // Posting from "Late Entry" with date:01-15 should be processed first
      // Then checking posting from "Regular Entry" at 01-18

      // Late Entry, food posting (date:01-15): food = +$50 (expenses are debits)
      const lateFood = balances.get(0)?.get(0)?.get('$');
      expect(lateFood).toBe(50);

      // Regular Entry, checking: +$100
      const regularChecking = balances.get(1)?.get(0)?.get('$');
      expect(regularChecking).toBe(100);
    });

    test('handles multiple postings with different dates in same transaction', () => {
      const content = `
2024-01-15 Transaction with multiple dates
    expenses:food  $10  ; date:2024-01-16
    expenses:gas   $20  ; date:2024-01-18
    assets:cash    ; no date (uses transaction date 01-15)
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateRunningBalances(parsed);

      // Cash posting (no date, uses 01-15): -$30 first (inferred)
      const cashBalance = balances.get(0)?.get(2)?.get('$');
      expect(cashBalance).toBe(-30);

      // Food posting (date:01-16): +$10 second (expenses are debits)
      const foodBalance = balances.get(0)?.get(0)?.get('$');
      expect(foodBalance).toBe(10);

      // Gas posting (date:01-18): +$20 last (expenses are debits)
      const gasBalance = balances.get(0)?.get(1)?.get('$');
      expect(gasBalance).toBe(20);
    });

    test('backward compatibility: transactions without posting dates work as before', () => {
      const content = `
2024-01-20 Transaction B
    assets:checking  $100
    income:salary

2024-01-15 Transaction A
    expenses:food  $10
    assets:checking
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateRunningBalances(parsed);

      // Without posting dates, transactions are processed by transaction date
      // Transaction A (01-15) should be processed first
      // Transaction B (01-20) should be processed second

      // Transaction A, food: +$10 (expenses are debits)
      const txAFood = balances.get(1)?.get(0)?.get('$');
      expect(txAFood).toBe(10);

      // Transaction A, checking: -$10 (inferred to balance)
      const txAChecking = balances.get(1)?.get(1)?.get('$');
      expect(txAChecking).toBe(-10);

      // Transaction B, checking: -$10 + $100 = $90
      const txBChecking = balances.get(0)?.get(0)?.get('$');
      expect(txBChecking).toBe(90);
    });

    test('respects effective dates with posting dates', () => {
      const content = `
2024-01-20 Transaction with both dates
    expenses:food  $10  ; date:2024-01-25
    assets:checking      ; date:2024-01-25

2024-01-18 Another transaction
    assets:checking  $100  ; date:2024-01-22
    income:salary
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateRunningBalances(parsed);

      // Chronological order:
      // 1. Another transaction, income (01-18): 0 (no amount)
      // 2. Another transaction, checking (date:01-22): +$100
      // 3. First transaction, food (date:01-25): -$10
      // 4. First transaction, checking (date:01-25): +$100 - $10 = $90

      const finalChecking = balances.get(0)?.get(1)?.get('$');
      expect(finalChecking).toBe(90);
    });

    test('handles same effective date for multiple postings', () => {
      const content = `
2024-01-15 Transaction A
    expenses:food  $10  ; date:2024-01-20
    assets:cash

2024-01-16 Transaction B
    expenses:gas  $20  ; date:2024-01-20
    assets:cash
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateRunningBalances(parsed);

      // Both postings with date:01-20 should maintain their transaction order
      // when effective dates are the same

      const foodBalance = balances.get(0)?.get(0)?.get('$');
      expect(foodBalance).toBe(10);

      const gasBalance = balances.get(1)?.get(0)?.get('$');
      expect(gasBalance).toBe(20);

      // Final cash balance (-$10 from txA - $20 from txB = -$30)
      const txBCash = balances.get(1)?.get(1)?.get('$');
      expect(txBCash).toBe(-30);
    });
  });

  describe('calculateAccountBalances', () => {
    test('calculates balances in effective date order', () => {
      const content = `
2024-01-20 Transaction B
    assets:checking  $100
    income:salary

2024-01-15 Transaction A
    expenses:food  $10
    assets:checking  ; date:2024-01-25
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateAccountBalances(parsed.transactions);

      // Final balances (after all postings):
      // checking: +$100 (01-20) - $10 (01-25) = $90
      // food: +$10 (expenses are debits, positive)
      // salary: -$100 (income is credits, negative)

      const checkingBalance = balances.get('assets:checking')?.get('$');
      expect(checkingBalance).toBe(90);

      const foodBalance = balances.get('expenses:food')?.get('$');
      expect(foodBalance).toBe(10);

      const salaryBalance = balances.get('income:salary')?.get('$');
      expect(salaryBalance).toBe(-100);
    });

    test('handles cross-boundary posting dates', () => {
      const content = `
2024-01-25 Late Transaction
    expenses:food  $50  ; date:2024-01-10
    assets:cash

2024-01-15 Middle Transaction
    assets:checking  $100
    income:salary

2024-01-20 Another Transaction
    expenses:gas  $20  ; date:2024-01-12
    assets:cash
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateAccountBalances(parsed.transactions);

      // Effective chronological order:
      // 1. Late Transaction, food (date:01-10): +$50
      // 2. Late Transaction, cash (01-25): -$50 (inferred)
      // 3. Another Transaction, gas (date:01-12): +$20
      // 4. Another Transaction, cash (01-20): -$20 (inferred)
      // 5. Middle Transaction, checking (01-15): +$100
      // 6. Middle Transaction, salary (01-15): -$100 (inferred)

      // Cash: -$50 (late, 01-25) - $20 (another, 01-20) = -$70
      const cashBalance = balances.get('assets:cash')?.get('$');
      expect(cashBalance).toBe(-70);

      // Food: +$50 (expenses are debits, positive)
      const foodBalance = balances.get('expenses:food')?.get('$');
      expect(foodBalance).toBe(50);

      // Gas: +$20
      const gasBalance = balances.get('expenses:gas')?.get('$');
      expect(gasBalance).toBe(20);
    });

    test('backward compatibility: works without posting dates', () => {
      const content = `
2024-01-20 Transaction B
    assets:checking  $100
    income:salary

2024-01-15 Transaction A
    expenses:food  $10
    assets:checking
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateAccountBalances(parsed.transactions);

      // Chronological order (by transaction date):
      // 1. Transaction A (01-15): food +$10, checking -$10 (inferred)
      // 2. Transaction B (01-20): checking +$100, salary -$100 (inferred)
      // Final checking balance: -$10 + $100 = $90
      const checkingBalance = balances.get('assets:checking')?.get('$');
      expect(checkingBalance).toBe(90);
    });
  });

  describe('hledger documentation example', () => {
    test('bank clearing date example', () => {
      const content = `
2015/5/30
    expenses:food     $10  ; food purchased on saturday 5/30
    assets:checking        ; bank cleared it on monday, date:6/1
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const balances = calculateRunningBalances(parsed);

      // Food expense on 5/30: +$10 (expenses increase with debits)
      const foodBalance = balances.get(0)?.get(0)?.get('$');
      expect(foodBalance).toBe(10);

      // Checking cleared on 6/1: -$10 (inferred, assets decrease with credits)
      const checkingBalance = balances.get(0)?.get(1)?.get('$');
      expect(checkingBalance).toBe(-10);
    });
  });
});
