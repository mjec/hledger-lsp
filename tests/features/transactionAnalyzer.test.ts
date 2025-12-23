import { TransactionAnalyzer } from '../../src/features/transactionAnalyzer';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';

describe('TransactionAnalyzer', () => {
  let analyzer: TransactionAnalyzer;
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
    analyzer = new TransactionAnalyzer();
  });

  describe('analyze', () => {
    test('should extract payee-to-account patterns', () => {
      const content = `2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Grocery Store
    Expenses:Food                 $30
    Assets:Checking               $-30

2024-01-17 * Gas Station
    Expenses:Transport            $40
    Assets:Checking               $-40`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      const groceryAccounts = analyzer.getAccountsForPayee('Grocery Store');
      expect(groceryAccounts).toHaveLength(2);
      expect(groceryAccounts[0].account).toBe('Expenses:Food');
      expect(groceryAccounts[0].frequency).toBe(2);
      expect(groceryAccounts[1].account).toBe('Assets:Checking');
      expect(groceryAccounts[1].frequency).toBe(2);
    });

    test('should sort accounts by frequency', () => {
      const content = `2024-01-15 * Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Store
    Expenses:Food                 $30
    Expenses:Fees                 $5
    Assets:Checking               $-35`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      const accounts = analyzer.getAccountsForPayee('Store');
      expect(accounts[0].account).toBe('Expenses:Food');
      expect(accounts[0].frequency).toBe(2);
      expect(accounts[1].account).toBe('Assets:Checking');
      expect(accounts[1].frequency).toBe(2);
      expect(accounts[2].account).toBe('Expenses:Fees');
      expect(accounts[2].frequency).toBe(1);
    });

    test('should track global account frequency', () => {
      const content = `2024-01-15 * Store1
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Store2
    Expenses:Transport            $30
    Assets:Checking               $-30

2024-01-17 * Store3
    Expenses:Utilities            $40
    Assets:Checking               $-40`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      const frequencies = analyzer.getAccountsByFrequency();
      expect(frequencies[0].account).toBe('Assets:Checking');
      expect(frequencies[0].count).toBe(3);
    });

    test('should handle payees with no matches', () => {
      const content = `2024-01-15 * Store
    Expenses:Food                 $50
    Assets:Checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      const accounts = analyzer.getAccountsForPayee('NonExistent');
      expect(accounts).toHaveLength(0);
    });

    test('should limit results', () => {
      const content = `2024-01-15 * Store
    Account1                      $10
    Account2                      $10
    Account3                      $10
    Account4                      $10
    Account5                      $10
    Account6                      $10
    Assets:Checking               $-60`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      const accounts = analyzer.getAccountsForPayee('Store', 3);
      expect(accounts).toHaveLength(3);
    });
  });

  describe('getAmountSuggestionsForPayeeAccount', () => {
    test('should suggest common amounts', () => {
      const content = `2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-17 * Grocery Store
    Expenses:Food                 $30
    Assets:Checking               $-30`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      const suggestions = analyzer.getAmountSuggestionsForPayeeAccount(
        'Grocery Store',
        'Expenses:Food',
        '$'
      );

      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].amount).toBe(50);
      expect(suggestions[0].frequency).toBe(2);
      expect(suggestions[1].amount).toBe(30);
      expect(suggestions[1].frequency).toBe(1);
    });
  });

  describe('getMostCommonPayeeAccountPairs', () => {
    test('should return most common pairs', () => {
      const content = `2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Grocery Store
    Expenses:Food                 $30
    Assets:Checking               $-30

2024-01-17 * Gas Station
    Expenses:Transport            $40
    Assets:Checking               $-40`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      const pairs = analyzer.getMostCommonPayeeAccountPairs(3);
      expect(pairs.length).toBeGreaterThan(0);
      expect(pairs[0]).toHaveProperty('payee');
      expect(pairs[0]).toHaveProperty('account');
      expect(pairs[0]).toHaveProperty('frequency');
    });
  });

  describe('hasPatterns', () => {
    test('should return false when no data', () => {
      expect(analyzer.hasPatterns()).toBe(false);
    });

    test('should return true after analyzing', () => {
      const content = `2024-01-15 * Store
    Expenses:Food                 $50
    Assets:Checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      analyzer.analyze(parsed);

      expect(analyzer.hasPatterns()).toBe(true);
    });
  });
});
