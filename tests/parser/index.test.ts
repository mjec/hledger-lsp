import { HledgerParser } from '../../src/parser';

import * as ast from '../../src/parser/ast';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Helper functions to convert Maps to sorted arrays for testing
// Strips sourceUri and line fields that are added by the parser
function mapToSortedArray<T extends { name: string; sourceUri?: string; line?: number }>(map: Map<string, T>): Partial<T>[] {
  return Array.from(map.values())
    .map(({ sourceUri, line, ...rest }) => rest as Partial<T>)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

describe('HledgerParser', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('parse', () => {
    test('should parse an empty document', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const result = parser.parse(doc);

      expect(result.transactions).toHaveLength(0);
      expect(result.accounts.size).toBe(0);
      expect(result.directives).toHaveLength(0);
      expect(result.commodities.size).toBe(0);
      expect(result.payees.size).toBe(0);
      expect(result.tags.size).toBe(0);
    });

    test('should parse a document with only comments', () => {
      const content = `; This is a comment
# Another comment
; Yet another comment`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions).toHaveLength(0);
    });

    test('should return a ParsedDocument structure', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food:groceries  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result).toHaveProperty('transactions');
      expect(result).toHaveProperty('accounts');
      expect(result).toHaveProperty('directives');
      expect(result).toHaveProperty('commodities');
      expect(result).toHaveProperty('payees');
      expect(result).toHaveProperty('tags');
    });

    test('should parse directives', () => {
      const content = `account Assets:Checking
commodity USD
payee Grocery Store
tag trip`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.directives).toHaveLength(4);
      expect(result.directives[0]).toEqual({ type: 'account', value: 'Assets:Checking', comment: undefined, sourceUri: 'file:///test.journal', line: 0 });
      expect(result.directives[1]).toEqual({ type: 'commodity', value: 'USD', comment: undefined, sourceUri: 'file:///test.journal', line: 1 });
      expect(result.directives[2]).toEqual({ type: 'payee', value: 'Grocery Store', comment: undefined, sourceUri: 'file:///test.journal', line: 2 });
      expect(result.directives[3]).toEqual({ type: 'tag', value: 'trip', comment: undefined, sourceUri: 'file:///test.journal', line: 3 });
    });

    test('should parse directives with comments', () => {
      const content = `account Assets:Checking ; Main checking account
commodity USD ; US Dollar`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.directives).toHaveLength(2);
      expect(result.directives[0]).toEqual({
        type: 'account',
        value: 'Assets:Checking',
        comment: 'Main checking account',
        sourceUri: 'file:///test.journal',
        line: 0
      });
      expect(result.directives[1]).toEqual({
        type: 'commodity',
        value: 'USD',
        comment: 'US Dollar',
        sourceUri: 'file:///test.journal',
        line: 1
      });
    });

    test('should parse transactions', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking

2024-01-16 ! Gas Station
    expenses:auto:fuel  $40.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].description).toBe('Grocery Store');
      expect(result.transactions[0].status).toBe('cleared');
      expect(result.transactions[1].description).toBe('Gas Station');
      expect(result.transactions[1].status).toBe('pending');
    });

    test('should parse mixed content', () => {
      const content = `; Journal file
account Assets:Checking
commodity USD

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking

payee Online Store

2024-01-16 Online Store
    expenses:shopping  $100.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.directives).toHaveLength(3);
      expect(result.transactions).toHaveLength(2);
    });

    test('should extract accounts from parsed content', () => {
      const content = `account Assets:Checking

2024-01-15 * Store
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.accounts.size).toBeGreaterThanOrEqual(2);
      const accountNames = Array.from(result.accounts.values()).map(a => a.name);
      expect(accountNames).toContain('Assets:Checking');
      expect(accountNames).toContain('expenses:food');
      expect(accountNames).toContain('assets:checking');
    });

    test('should extract payees from parsed content', () => {
      const content = `payee Grocery Store

2024-01-15 * Coffee Shop
    expenses:food  $5.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.payees.size).toBeGreaterThanOrEqual(2);
      const payeeNames = Array.from(result.payees.values()).map(p => p.name);
      expect(payeeNames).toContain('Grocery Store');
      expect(payeeNames).toContain('Coffee Shop');
    });

    test('should extract commodities from parsed content', () => {
      const content = `commodity USD

2024-01-15 * Store
    expenses:food  €25.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.commodities.size).toBeGreaterThanOrEqual(2);
      const commodityNames = Array.from(result.commodities.values()).map(c => c.name);
      expect(commodityNames).toContain('USD');
      expect(commodityNames).toContain('€');
    });

    test('should extract tags from parsed content', () => {
      const content = `tag trip

2024-01-15 * Hotel ; trip:paris vacation:summer
    expenses:lodging  €100.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.tags.size).toBeGreaterThanOrEqual(2);
      const tagNames = Array.from(result.tags.values()).map(t => t.name);
      expect(tagNames).toContain('trip');
      expect(tagNames).toContain('vacation');
    });

    test('should handle include and alias directives', () => {
      const content = `include other.journal
alias old:account = new:account`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.directives).toHaveLength(2);
      expect(result.directives[0]).toEqual({ type: 'include', value: 'other.journal', comment: undefined, sourceUri: 'file:///test.journal', line: 0 });
      expect(result.directives[1]).toEqual({ type: 'alias', value: 'old:account = new:account', comment: undefined, sourceUri: 'file:///test.journal', line: 1 });
    });

    test('should handle transactions separated by blank lines', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking

2024-01-16 * Store B
    expenses:food  $30.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions).toHaveLength(2);
    });

    test('should handle transactions without blank line separator', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking
2024-01-16 * Store B
    expenses:food  $30.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions).toHaveLength(2);
    });
  });

  describe('parse - accounts extraction', () => {
    test('should extract accounts from a simple transaction', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food:groceries  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const accounts = mapToSortedArray(parsed.accounts);

      expect(accounts).toEqual([
        { name: 'assets:checking', declared: false },
        { name: 'expenses:food:groceries', declared: false }
      ]);
    });

    test('should extract accounts from multiple transactions', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking

2024-01-16 * Gas Station
    expenses:fuel  $30.00
    liabilities:credit card`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const accounts = mapToSortedArray(parser.parse(doc).accounts);

      expect(accounts).toEqual([
        { name: 'assets:checking', declared: false },
        { name: 'expenses:food', declared: false },
        { name: 'expenses:fuel', declared: false },
        { name: 'liabilities:credit card', declared: false }
      ]);
    });

    test('should extract accounts from account directives', () => {
      const content = `account assets:bank:checking
account expenses:food
account income:salary

2024-01-15 * Transaction
    expenses:food  $20
    assets:bank:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const accounts = mapToSortedArray(parser.parse(doc).accounts);

      expect(accounts).toEqual([
        { name: 'assets:bank:checking', declared: true },
        { name: 'expenses:food', declared: true },
        { name: 'income:salary', declared: true }
      ]);
    });

    test('should deduplicate accounts', () => {
      const content = `2024-01-15 * Transaction 1
    expenses:food  $20
    assets:checking

2024-01-16 * Transaction 2
    expenses:food  $30
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const accounts = mapToSortedArray(parser.parse(doc).accounts);

      expect(accounts).toEqual([
        { name: 'assets:checking', declared: false },
        { name: 'expenses:food', declared: false }
      ]);
    });

    test('should handle account directives with comments', () => {
      const content = `account assets:checking  ; main checking account
account expenses:food    ; grocery expenses`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const accounts = mapToSortedArray(parser.parse(doc).accounts);

      expect(accounts).toEqual([
        { name: 'assets:checking', declared: true },
        { name: 'expenses:food', declared: true }
      ]);
    });

    test('should handle empty documents', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const accounts = mapToSortedArray(parser.parse(doc).accounts);

      expect(accounts).toEqual([]);
    });

    test('should return sorted accounts', () => {
      const content = `2024-01-15 * Test
    zzz:last  $10
    aaa:first  $-10`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const accounts = mapToSortedArray(parser.parse(doc).accounts);

      expect(accounts).toEqual([
        { name: 'aaa:first', declared: false },
        { name: 'zzz:last', declared: false }
      ]);
    });

    test('should mark declared accounts as declared', () => {
      const content = `account assets:checking

2024-01-15 * Transaction
    assets:checking  $100
    expenses:food  $-100`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const accounts = mapToSortedArray(parser.parse(doc).accounts);

      expect(accounts).toEqual([
        { name: 'assets:checking', declared: true },
        { name: 'expenses:food', declared: false }
      ]);
    });
  });

  describe('parse - payees extraction', () => {
    test('should extract payees from transactions', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking

2024-01-20 * Gas Station
    expenses:fuel  $40.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([
        { name: 'Gas Station', declared: false },
        { name: 'Grocery Store', declared: false }
      ]);
    });

    test('should extract payees from payee directives', () => {
      const content = `payee Walmart
payee Target
payee Amazon

2024-01-15 * Walmart
    expenses:shopping  $100
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([
        { name: 'Amazon', declared: true },
        { name: 'Target', declared: true },
        { name: 'Walmart', declared: true }
      ]);
    });

    test('should deduplicate payees', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50
    assets:checking

2024-01-20 * Grocery Store
    expenses:food  $30
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([
        { name: 'Grocery Store', declared: false }
      ]);
    });

    test('should extract payees from transactions with different statuses', () => {
      const content = `2024-01-15 * Cleared Payee
    expenses:food  $50
    assets:checking

2024-01-16 ! Pending Payee
    expenses:food  $30
    assets:checking

2024-01-17 Unmarked Payee
    expenses:food  $20
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([
        { name: 'Cleared Payee', declared: false },
        { name: 'Pending Payee', declared: false },
        { name: 'Unmarked Payee', declared: false }
      ]);
    });

    test('should handle payee directives with comments', () => {
      const content = `payee Walmart  ; big box store
payee Target   ; another store`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([
        { name: 'Target', declared: true },
        { name: 'Walmart', declared: true }
      ]);
    });

    test('should handle empty documents', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([]);
    });

    test('should return sorted payees', () => {
      const content = `2024-01-15 * Zebra Store
2024-01-16 * Apple Store`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([
        { name: 'Apple Store', declared: false },
        { name: 'Zebra Store', declared: false }
      ]);
    });

    test('should mark declared payees as declared', () => {
      const content = `payee Walmart

2024-01-15 * Walmart
    expenses:shopping  $100
    assets:checking

2024-01-16 * Target
    expenses:shopping  $50
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const payees = mapToSortedArray(parser.parse(doc).payees);

      expect(payees).toEqual([
        { name: 'Target', declared: false },
        { name: 'Walmart', declared: true }
      ]);
    });
  });

  describe('parse - commodities extraction', () => {
    test('should extract commodities from postings', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  -50.00 USD`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: '$', declared: false },
        { name: 'USD', declared: false }
      ]);
    });

    test('should extract commodities from commodity directives', () => {
      const content = `commodity USD
commodity EUR
commodity GBP

2024-01-15 * Transaction
    expenses:food  $50
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: '$', declared: false },
        { name: 'EUR', declared: true },
        { name: 'GBP', declared: true },
        { name: 'USD', declared: true }
      ]);
    });

    test('should extract commodities from commodity directives with formats', () => {
      const content = `commodity $1000.00
commodity 1.000,00 EUR
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: '$', declared: true, format: { symbol: '$', symbolOnLeft: true, spaceBetween: false, decimalMark: '.', thousandsSeparator: null, precision: 2 } },
        { name: 'EUR', declared: true, format: { symbol: 'EUR', symbolOnLeft: false, spaceBetween: true, decimalMark: ',', thousandsSeparator: '.', precision: 2 } }
      ]);
    });

    test('should deduplicate commodities', () => {
      const content = `2024-01-15 * Transaction 1
    expenses:food  $50
    assets:checking  $-50

2024-01-16 * Transaction 2
    expenses:fuel  $30
    assets:checking  $-30`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: '$', declared: false }
      ]);
    });

    test('should extract commodities from balance assertions', () => {
      const content = `2024-01-15 * Deposit
    assets:checking  $100 = $500
    income:salary`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: '$', declared: false }
      ]);
    });

    test('should extract various currency symbols', () => {
      const content = `2024-01-15 * Multi-currency
    expenses:food  €50
    expenses:transport  £20
    expenses:misc  ¥1000
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: '£', declared: false },
        { name: '¥', declared: false },
        { name: '€', declared: false }
      ]);
    });

    test('should handle commodity directives with comments', () => {
      const content = `commodity USD  ; US Dollar
commodity EUR  ; Euro`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: 'EUR', declared: true },
        { name: 'USD', declared: true }
      ]);
    });

    test('should not include empty commodity', () => {
      const content = `2024-01-15 * Transaction
    expenses:food  50
    assets:checking  -50`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([]);
    });

    test('should handle empty documents', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([]);
    });

    test('should return sorted commodities', () => {
      const content = `2024-01-15 * Transaction
    expenses:a  ZAR 100
    expenses:b  AUD 50
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: 'AUD', declared: false },
        { name: 'ZAR', declared: false }
      ]);
    });

    test('should mark declared commodities as declared', () => {
      const content = `commodity USD

2024-01-15 * Transaction
    expenses:food  $50
    assets:checking  -50 USD`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const commodities = mapToSortedArray(parser.parse(doc).commodities);

      expect(commodities).toEqual([
        { name: '$', declared: false },
        { name: 'USD', declared: true }
      ]);
    });
  });

  describe('parse - tags extraction', () => {
    test('should extract tags from transaction header comments', () => {
      const content = `2024-01-15 * Grocery Store  ; category:food store:walmart
    expenses:food  $50
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'category', declared: false },
        { name: 'store', declared: false }
      ]);
    });

    test('should extract tags from posting comments', () => {
      const content = `2024-01-15 * Transaction
    expenses:food  $50  ; category:groceries important:
    assets:checking  ; account:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'account', declared: false },
        { name: 'category', declared: false },
        { name: 'important', declared: false }
      ]);
    });

    test('should extract tags from transaction-level comments', () => {
      const content = `2024-01-15 * Grocery Store
    ; project:home category:food
    expenses:food  $50
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'category', declared: false },
        { name: 'project', declared: false }
      ]);
    });

    test('should extract tags from tag directives', () => {
      const content = `tag project
tag category
tag important

2024-01-15 * Transaction
    expenses:food  $50
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'category', declared: true },
        { name: 'important', declared: true },
        { name: 'project', declared: true }
      ]);
    });

    test('should deduplicate tags', () => {
      const content = `2024-01-15 * Transaction 1  ; category:food
    expenses:food  $50
    assets:checking

2024-01-16 * Transaction 2  ; category:transport
    expenses:fuel  $30
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'category', declared: false }
      ]);
    });

    test('should extract tags from multiple sources', () => {
      const content = `tag project

2024-01-15 * Grocery Store  ; category:food
    ; important:
    expenses:food  $50  ; store:walmart
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'category', declared: false },
        { name: 'important', declared: false },
        { name: 'project', declared: true },
        { name: 'store', declared: false }
      ]);
    });

    test('should handle tag directives with comments', () => {
      const content = `tag project  ; for organizing expenses
tag category ; type of expense`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'category', declared: true },
        { name: 'project', declared: true }
      ]);
    });

    test('should handle empty documents', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([]);
    });

    test('should return sorted tag names', () => {
      const content = `2024-01-15 * Test  ; zebra: apple:`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'apple', declared: false },
        { name: 'zebra', declared: false }
      ]);
    });

    test('should mark declared tags as declared', () => {
      const content = `tag project

2024-01-15 * Transaction  ; project:home category:food
    expenses:food  $50
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const tags = mapToSortedArray(parser.parse(doc).tags);

      expect(tags).toEqual([
        { name: 'category', declared: false },
        { name: 'project', declared: true }
      ]);
    });
  });

  describe('include directives', () => {
    test('should follow includes when option is set', () => {
      const mainContent = `include included.journal

2024-01-15 * Main transaction
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const includedContent = `2024-01-16 * Included transaction
    expenses:shopping  $30.00
    assets:checking  $-30.00`;

      const mainDoc = TextDocument.create('file:///home/user/main.journal', 'hledger', 1, mainContent);
      const includedDoc = TextDocument.create('file:///home/user/included.journal', 'hledger', 1, includedContent);

      const fileReader = (uri: string) => {
        if (uri === 'file:///home/user/included.journal') {
          return includedDoc;
        }
        return null;
      };

      const result = parser.parse(mainDoc, {
        baseUri: mainDoc.uri,
        fileReader
      });

      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].description).toBe('Main transaction');
      expect(result.transactions[1].description).toBe('Included transaction');
    });

    test('should resolve relative include paths', () => {
      const mainContent = `include subdir/included.journal

2024-01-15 * Main
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const includedContent = `2024-01-16 * Included
    expenses:shopping  $30.00
    assets:checking  $-30.00`;

      const mainDoc = TextDocument.create('file:///home/user/main.journal', 'hledger', 1, mainContent);
      const includedDoc = TextDocument.create('file:///home/user/subdir/included.journal', 'hledger', 1, includedContent);

      const fileReader = (uri: string) => {
        if (uri === 'file:///home/user/subdir/included.journal') {
          return includedDoc;
        }
        return null;
      };

      const result = parser.parse(mainDoc, {
        baseUri: mainDoc.uri,
        fileReader
      });

      expect(result.transactions).toHaveLength(2);
    });

    test('should resolve absolute include paths (starting with /)', () => {
      const mainContent = `include /common.journal

2024-01-15 * Main
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const includedContent = `2024-01-16 * Common
    expenses:utilities  $100.00
    assets:checking  $-100.00`;

      const mainDoc = TextDocument.create('file:///home/user/main.journal', 'hledger', 1, mainContent);
      // For leading-slash includes we expect the path to be treated as an absolute
      // filesystem path, i.e. file:///common.journal (system root). The parser's
      // resolver should therefore request that exact URI from the fileReader.
      const includedDoc = TextDocument.create('file:///common.journal', 'hledger', 1, includedContent);

      const fileReader = (uri: string) => {
        if (uri === 'file:///common.journal') {
          return includedDoc;
        }
        return null;
      };

      const result = parser.parse(mainDoc, {
        baseUri: mainDoc.uri,
        fileReader
      });

      expect(result.transactions).toHaveLength(2);
    });

    test('should expand tilde (~) to home directory in include paths', () => {
      const mainContent = `include ~/common.journal

2024-01-15 * Main
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const includedContent = `2024-01-16 * CommonHome
    expenses:utilities  $100.00
    assets:checking  $-100.00`;

      const mainDoc = TextDocument.create('file:///home/user/main.journal', 'hledger', 1, mainContent);
      // Expand ~ to the current user's home directory
      const homedir = require('os').homedir();
      const includedUri = `file://${homedir}/common.journal`;
      const includedDoc = TextDocument.create(includedUri, 'hledger', 1, includedContent);

      const fileReader = (uri: string) => {
        if (uri === includedUri) {
          return includedDoc;
        }
        return null;
      };

      const result = parser.parse(mainDoc, {
        baseUri: mainDoc.uri,
        fileReader
      });

      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[1].description).toBe('CommonHome');
    });

    test('should handle missing include files gracefully', () => {
      const content = `include missing.journal

2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const doc = TextDocument.create('file:///main.journal', 'hledger', 1, content);

      const fileReader = (uri: string) => {
        return null; // File not found
      };

      const result = parser.parse(doc, {
        baseUri: doc.uri,
        fileReader
      });

      // Should still parse the main file
      expect(result.transactions).toHaveLength(1);
      expect(result.directives).toHaveLength(1);
    });

    test('should detect and handle circular includes', () => {
      const file1Content = `include file2.journal
2024-01-15 * File 1
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const file2Content = `include file1.journal
2024-01-16 * File 2
    expenses:shopping  $30.00
    assets:checking  $-30.00`;

      const file1Doc = TextDocument.create('file:///home/user/file1.journal', 'hledger', 1, file1Content);
      const file2Doc = TextDocument.create('file:///home/user/file2.journal', 'hledger', 1, file2Content);

      const fileReader = (uri: string) => {
        if (uri === 'file:///home/user/file2.journal') {
          return file2Doc;
        }
        if (uri === 'file:///home/user/file1.journal') {
          return file1Doc;
        }
        return null;
      };

      const result = parser.parse(file1Doc, {
        baseUri: file1Doc.uri,
        fileReader
      });

      // Should not loop infinitely, should include each file once
      expect(result.transactions).toHaveLength(2);
    });

    test('should merge account declarations from included files', () => {
      const mainContent = `account assets:checking
include included.journal

2024-01-15 * Main
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const includedContent = `account expenses:food

2024-01-16 * Included
    expenses:food  $30.00
    assets:checking  $-30.00`;

      const mainDoc = TextDocument.create('file:///main.journal', 'hledger', 1, mainContent);
      const includedDoc = TextDocument.create('file:///included.journal', 'hledger', 1, includedContent);

      const fileReader = (uri: string) => {
        if (uri === 'file:///included.journal') {
          return includedDoc;
        }
        return null;
      };

      const result = parser.parse(mainDoc, {
        baseUri: mainDoc.uri,
        fileReader
      });

      // Both accounts should be marked as declared
      const checking = result.accounts.get('assets:checking');
      const food = result.accounts.get('expenses:food');

      expect(checking?.declared).toBe(true);
      expect(food?.declared).toBe(true);
    });

    test('should use cache for repeated includes', () => {
      const mainContent = `include common.journal
include common.journal

2024-01-15 * Main
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const commonContent = `account assets:common

2024-01-16 * Common
    expenses:utilities  $100.00
    assets:checking  $-100.00`;

      const mainDoc = TextDocument.create('file:///main.journal', 'hledger', 1, mainContent);
      const commonDoc = TextDocument.create('file:///common.journal', 'hledger', 1, commonContent);

      let readCount = 0;
      const fileReader = (uri: string) => {
        if (uri === 'file:///common.journal') {
          readCount++;
          return commonDoc;
        }
        return null;
      };

      const result = parser.parse(mainDoc, {
        baseUri: mainDoc.uri,
        fileReader
      });

      // Should only read the file once due to caching
      expect(readCount).toBe(1);
      // Transactions should not be duplicated
      expect(result.transactions).toHaveLength(2);
    });

    test('should clear cache when requested', () => {
      const content = `2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      parser.parse(doc, {
        baseUri: doc.uri
      });

      // Clear cache
      parser.clearCache();

      // Should be able to parse again without issues
      const result = parser.parse(doc);
      expect(result.transactions).toHaveLength(1);
    });
  });

  describe('parseTransaction', () => {
    describe('validation and error handling', () => {
      test('should return null for empty input', () => {
        const result = ast.parseTransaction([], 0);
        expect(result).toBeNull();
      });

      test('should return null for non-transaction lines', () => {
        const lines = ['account assets:bank', '; comment'];
        const result = ast.parseTransaction(lines, 0);
        expect(result).toBeNull();
      });

      test('should return null for invalid start line', () => {
        const lines = ['2024-01-15 * Test'];
        const result = ast.parseTransaction(lines, 10);
        expect(result).toBeNull();
      });
    });

    describe('basic transaction parsing', () => {
      test('should parse a simple transaction', () => {
        const lines = [
          '2024-01-15 Grocery Store',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.date).toBe('2024-01-15');
        expect(result?.description).toBe('Grocery Store');
        expect(result?.postings).toHaveLength(2);
        expect(result?.postings[0].account).toBe('expenses:food');
        expect(result?.postings[1].account).toBe('assets:checking');
      });

      test('should parse transaction with cleared status', () => {
        const lines = [
          '2024-01-15 * Grocery Store',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.status).toBe('cleared');
      });

      test('should parse transaction with pending status', () => {
        const lines = [
          '2024-01-15 ! Pending Payment',
          '    expenses:rent    $1000',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.status).toBe('pending');
      });

      test('should parse transaction without status', () => {
        const lines = [
          '2024-01-15 No Status',
          '    expenses:food    $10',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.status).toBeUndefined();
      });
    });

    describe('transaction header features', () => {
      test('should parse transaction with effective date', () => {
        const lines = [
          '2024-01-15=2024-01-20 Grocery Store',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.date).toBe('2024-01-15');
        expect(result?.effectiveDate).toBe('2024-01-20');
      });

      test('should parse transaction with code', () => {
        const lines = [
          '2024-01-15 * (CHECK-123) Grocery Store',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.code).toBe('CHECK-123');
      });

      test('should parse transaction with header comment', () => {
        const lines = [
          '2024-01-15 * Grocery Store  ; weekly shopping',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.comment).toBe('weekly shopping');
      });

      test('should parse transaction with all header features', () => {
        const lines = [
          '2024-01-15=2024-01-20 * (CHECK-123) Grocery Store  ; weekly shopping',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.date).toBe('2024-01-15');
        expect(result?.effectiveDate).toBe('2024-01-20');
        expect(result?.status).toBe('cleared');
        expect(result?.code).toBe('CHECK-123');
        expect(result?.description).toBe('Grocery Store');
        expect(result?.comment).toBe('weekly shopping');
      });
    });

    describe('payee and note parsing', () => {
      test('should parse description without pipe as both payee and note', () => {
        const lines = [
          '2024-01-15 Grocery Store',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.description).toBe('Grocery Store');
        expect(result?.payee).toBe('Grocery Store');
        expect(result?.note).toBe('Grocery Store');
      });

      test('should parse payee and note separated by pipe', () => {
        const lines = [
          '2024-01-15 Grocery Store | weekly shopping',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.description).toBe('Grocery Store | weekly shopping');
        expect(result?.payee).toBe('Grocery Store');
        expect(result?.note).toBe('weekly shopping');
      });

      test('should parse empty payee with pipe', () => {
        const lines = [
          '2024-01-15 | weekly shopping',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.description).toBe('| weekly shopping');
        expect(result?.payee).toBe('');
        expect(result?.note).toBe('weekly shopping');
      });

      test('should parse empty note with pipe', () => {
        const lines = [
          '2024-01-15 Grocery Store |',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.description).toBe('Grocery Store |');
        expect(result?.payee).toBe('Grocery Store');
        expect(result?.note).toBe('');
      });

      test('should parse payee with status and code', () => {
        const lines = [
          '2024-01-15 * (123) Grocery Store | weekly shopping',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.description).toBe('Grocery Store | weekly shopping');
        expect(result?.payee).toBe('Grocery Store');
        expect(result?.note).toBe('weekly shopping');
        expect(result?.status).toBe('cleared');
        expect(result?.code).toBe('123');
      });
    });

    describe('posting parsing', () => {
      test('should parse multiple postings', () => {
        const lines = [
          '2024-01-15 Split Transaction',
          '    expenses:food        $30.00',
          '    expenses:transport   $20.00',
          '    assets:checking      $-50.00'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings).toHaveLength(3);
        expect(result?.postings[0].account).toBe('expenses:food');
        expect(result?.postings[0].amount).toEqual(expect.objectContaining({ quantity: 30, commodity: '$' }));
        expect(result?.postings[1].account).toBe('expenses:transport');
        expect(result?.postings[1].amount).toEqual(expect.objectContaining({ quantity: 20, commodity: '$' }));
        expect(result?.postings[2].account).toBe('assets:checking');
        expect(result?.postings[2].amount).toEqual(expect.objectContaining({ quantity: -50, commodity: '$' }));
      });

      test('should parse transaction with posting comments', () => {
        const lines = [
          '2024-01-15 Grocery Store',
          '    expenses:food    $50.00  ; organic vegetables',
          '    assets:checking          ; main account'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[0].comment).toBe('organic vegetables');
        expect(result?.postings[1].comment).toBe('main account');
      });

      test('should parse transaction with balance assertions', () => {
        const lines = [
          '2024-01-15 Deposit',
          '    assets:checking    $100 = $500',
          '    income:salary      $-100'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[0].assertion).toEqual(expect.objectContaining({ quantity: 500, commodity: '$' }));
      });
    });

    describe('comments and tags', () => {
      test('should extract tags from header comment', () => {
        const lines = [
          '2024-01-15 Grocery Store  ; category:food store:walmart',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.tags).toEqual({
          category: 'food',
          store: 'walmart'
        });
      });

      test('should handle transaction-level comments', () => {
        const lines = [
          '2024-01-15 Grocery Store',
          '    ; This is a transaction comment',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.comment).toBe('This is a transaction comment');
      });

      test('should extract tags from transaction-level comments', () => {
        const lines = [
          '2024-01-15 Grocery Store',
          '    ; project:home category:groceries',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.tags).toEqual({
          project: 'home',
          category: 'groceries'
        });
      });
    });

    describe('transaction boundaries', () => {
      test('should stop at empty line', () => {
        const lines = [
          '2024-01-15 Transaction 1',
          '    expenses:food    $50.00',
          '    assets:checking',
          '',
          '2024-01-16 Transaction 2',
          '    expenses:rent    $1000',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.date).toBe('2024-01-15');
        expect(result?.postings).toHaveLength(2);
      });

      test('should stop at next transaction', () => {
        const lines = [
          '2024-01-15 Transaction 1',
          '    expenses:food    $50.00',
          '    assets:checking',
          '2024-01-16 Transaction 2',
          '    expenses:rent    $1000',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.date).toBe('2024-01-15');
        expect(result?.postings).toHaveLength(2);
      });

      test('should handle transaction with slash-separated date', () => {
        const lines = [
          '2024/01/15 Grocery Store',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.date).toBe('2024/01/15');
      });
    });

    describe('edge cases', () => {
      test('should parse transaction with only one posting', () => {
        const lines = [
          '2024-01-15 Opening Balance',
          '    assets:checking    $1000'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings).toHaveLength(1);
      });

      test('should parse transaction with no postings', () => {
        const lines = [
          '2024-01-15 Empty Transaction'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings).toHaveLength(0);
      });

      test('should handle posting without amount', () => {
        const lines = [
          '2024-01-15 Transaction',
          '    expenses:food    $50.00',
          '    assets:checking'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[1].amount).toBeUndefined();
      });
    });

    describe('inferred cost notation', () => {
      test('should infer total cost for two-commodity transaction', () => {
        const lines = [
          '2009-01-01 Currency Exchange',
          '    assets:euros     €100',
          '    assets:dollars  $-135'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings).toHaveLength(2);

        // First posting should have inferred cost
        expect(result?.postings[0].amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.postings[0].cost).toEqual({
          type: 'total',
          amount: expect.objectContaining({ quantity: 135, commodity: '$' })
        });

        // Second posting should not have cost
        expect(result?.postings[1].amount).toEqual(expect.objectContaining({ quantity: -135, commodity: '$' }));
        expect(result?.postings[1].cost).toBeUndefined();
      });

      test('should infer cost with swapped commodity order', () => {
        const lines = [
          '2009-01-01 Transaction',
          '    assets:dollars  $-135',
          '    assets:euros     €100'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();

        // First posting (dollars) should have inferred cost in euros
        expect(result?.postings[0].amount).toEqual(expect.objectContaining({ quantity: -135, commodity: '$' }));
        expect(result?.postings[0].cost).toEqual({
          type: 'total',
          amount: expect.objectContaining({ quantity: -100, commodity: '€' })
        });
      });

      test('should infer cost with multiple postings in same commodity', () => {
        const lines = [
          '2009-01-01 Split Purchase',
          '    assets:euros     €100',
          '    assets:dollars  $-100',
          '    assets:dollars  $-35'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();

        // First posting should have inferred cost (sum of all dollar postings, negated)
        expect(result?.postings[0].cost).toEqual({
          type: 'total',
          amount: expect.objectContaining({ quantity: 135, commodity: '$' })  // -(-100 + -35) = 135
        });
      });

      test('should NOT infer cost when posting has missing amount', () => {
        const lines = [
          '2009-01-01 Transaction',
          '    assets:euros     €100',
          '    assets:dollars'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[0].cost).toBeUndefined();
        expect(result?.postings[1].cost).toBeUndefined();
      });

      test('should NOT infer cost when explicit cost notation exists', () => {
        const lines = [
          '2009-01-01 Transaction',
          '    assets:euros     €100 @ $1.35',
          '    assets:dollars  $-135'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();

        // Should keep explicit cost, not infer a different one
        expect(result?.postings[0].cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: 1.35, commodity: '$' })
        });

        // Should not add cost to second posting
        expect(result?.postings[1].cost).toBeUndefined();
      });

      test('should NOT infer cost for single commodity transaction', () => {
        const lines = [
          '2009-01-01 Transaction',
          '    expenses:food    $50',
          '    assets:checking  $-50'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[0].cost).toBeUndefined();
        expect(result?.postings[1].cost).toBeUndefined();
      });

      test('should NOT infer cost for three+ commodity transaction', () => {
        const lines = [
          '2009-01-01 Transaction',
          '    assets:euros     €100',
          '    assets:dollars  $-135',
          '    assets:pounds    £50'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[0].cost).toBeUndefined();
        expect(result?.postings[1].cost).toBeUndefined();
        expect(result?.postings[2].cost).toBeUndefined();
      });

      test('should infer cost with decimal precision', () => {
        const lines = [
          '2009-01-01 Stock Purchase',
          '    assets:stock     10 AAPL',
          '    assets:cash     $-1505.50'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[0].cost).toEqual({
          type: 'total',
          amount: expect.objectContaining({ quantity: 1505.50, commodity: '$' })
        });
      });

      test('should handle negative amounts in first posting', () => {
        const lines = [
          '2009-01-01 Currency Sell',
          '    assets:euros     €-100',
          '    assets:dollars  $135'
        ];
        const result = ast.parseTransaction(lines, 0);

        expect(result).not.toBeNull();
        expect(result?.postings[0].cost).toEqual({
          type: 'total',
          amount: expect.objectContaining({ quantity: -135, commodity: '$' })
        });
      });
    });
  });

  describe('parsePosting', () => {
    describe('basic posting parsing', () => {
      test('should parse posting with account only', () => {
        const line = '    assets:checking';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:checking');
        expect(result?.amount).toBeUndefined();
        expect(result?.assertion).toBeUndefined();
        expect(result?.comment).toBeUndefined();
      });

      test('should parse posting with multi-word account', () => {
        const line = '    liabilities:credit card';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('liabilities:credit card');
      });

      test('should return null for non-posting lines', () => {
        expect(ast.parsePosting('2024-01-15 * Payee')).toBeNull();
        expect(ast.parsePosting('; comment')).toBeNull();
        expect(ast.parsePosting('account assets:bank')).toBeNull();
        expect(ast.parsePosting('')).toBeNull();
      });

      test('should return null for unindented lines', () => {
        const line = 'assets:checking';
        const result = ast.parsePosting(line);
        expect(result).toBeNull();
      });
    });

    describe('amount parsing', () => {
      test('should parse posting with symbol-prefixed amount', () => {
        const line = '    expenses:food                $50.00';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('expenses:food');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 50, commodity: '$' }));
      });

      test('should parse posting with symbol-suffixed amount', () => {
        const line = '    expenses:rent               1000 USD';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('expenses:rent');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 1000, commodity: 'USD' }));
      });

      test('should parse negative amounts', () => {
        const line = '    income:salary               -2500.00 EUR';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: -2500, commodity: 'EUR' }));
      });

      test('should parse amounts with comma separators', () => {
        const line = '    assets:savings              1,000.00 USD';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 1000, commodity: 'USD' }));
      });

      test('should parse posting with symbol-prefixed with space amount', () => {
        const line = '    assets:savings            USD 1,000.00'
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 1000, commodity: 'USD' }))
      })

      test('should parse posting with symbol-suffixed without space amount', () => {
        const line = '    assets:savings            1,000.00USD'
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 1000, commodity: 'USD' }))
      })

      test('should parse negative amounts with leading commodity', () => {
        const line = '    income:salary               $-2500.00';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: -2500, commodity: '$' }));
      });

      test('should parse negative amounts with leading commodity after - sign', () => {
        const line = '    income:salary               -$2500.00';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: -2500, commodity: '$' }));
      });

      test('should parse negative amounts with leading commodity with space', () => {
        const line = '    income:salary               USD -2500.00';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: -2500, commodity: 'USD' }));
      });

      test('should parse amounts with various currency symbols', () => {
        const testCases = [
          { line: '    expenses:food    €25.50', expected: { quantity: 25.5, commodity: '€' } },
          { line: '    expenses:food    £15.75', expected: { quantity: 15.75, commodity: '£' } },
          { line: '    expenses:food    ¥500', expected: { quantity: 500, commodity: '¥' } }
        ];

        testCases.forEach(({ line, expected }) => {
          const result = ast.parsePosting(line);
          expect(result?.amount).toEqual(expect.objectContaining(expected));
        });
      });

      test('should parse amounts without commodity', () => {
        const line = '    assets:checking             100';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '' }));
      });
    });

    describe('comment parsing', () => {
      test('should parse posting with comment', () => {
        const line = '    expenses:food                $20  ; groceries';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('expenses:food');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 20, commodity: '$' }));
        expect(result?.comment).toBe('groceries');
      });

      test('should parse posting with comment but no amount', () => {
        const line = '    assets:savings               ; opening balance';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:savings');
        expect(result?.comment).toBe('opening balance');
        expect(result?.amount).toBeUndefined();
      });

      test('should extract tags from comments', () => {
        const line = '    expenses:food    $20  ; category:groceries store:walmart';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.tags).toEqual({
          category: 'groceries',
          store: 'walmart'
        });
      });

      test('should handle tags without values', () => {
        const line = '    expenses:food    $20  ; important:';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.tags).toEqual({ important: '' });
      });
    });

    describe('balance assertion parsing', () => {
      test('should parse posting with balance assertion only', () => {
        const line = '    liabilities:credit card          = $-500';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('liabilities:credit card');
        expect(result?.assertion).toEqual(expect.objectContaining({ quantity: -500, commodity: '$' }));
        expect(result?.amount).toBeUndefined();
      });

      test('should parse posting with both amount and assertion', () => {
        const line = '    assets:checking              $50.25  = $150.25';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:checking');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 50.25, commodity: '$' }));
        expect(result?.assertion).toEqual(expect.objectContaining({ quantity: 150.25, commodity: '$' }));
      });

      test('should parse posting with amount, assertion, and comment', () => {
        const line = '    assets:checking              $50.25  = $150.25  ; balance check';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:checking');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 50.25, commodity: '$' }));
        expect(result?.assertion).toEqual(expect.objectContaining({ quantity: 150.25, commodity: '$' }));
        expect(result?.comment).toBe('balance check');
      });

      test('should handle assertion with different commodity formats', () => {
        const line = '    assets:savings               100 USD = 1000 USD';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: 'USD' }));
        expect(result?.assertion).toEqual(expect.objectContaining({ quantity: 1000, commodity: 'USD' }));
      });
    });

    describe('cost notation parsing', () => {
      test('should parse posting with unit cost (@)', () => {
        const line = '    assets:euros                 €100 @ $1.35';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:euros');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: 1.35, commodity: '$' })
        });
      });

      test('should parse posting with total cost (@@)', () => {
        const line = '    assets:euros                 €100 @@ $135';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:euros');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.cost).toEqual({
          type: 'total',
          amount: expect.objectContaining({ quantity: 135, commodity: '$' })
        });
      });

      test('should parse posting with cost and balance assertion', () => {
        const line = '    assets:euros                 €100 @ $1.35 = €100';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:euros');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: 1.35, commodity: '$' })
        });
        expect(result?.assertion).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
      });

      test('should parse posting with total cost and balance assertion', () => {
        const line = '    assets:euros                 €100 @@ $135 = €100';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:euros');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.cost).toEqual({
          type: 'total',
          amount: expect.objectContaining({ quantity: 135, commodity: '$' })
        });
        expect(result?.assertion).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
      });

      test('should parse posting with cost and comment', () => {
        const line = '    assets:euros                 €100 @ $1.35  ; purchase euros';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:euros');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: 1.35, commodity: '$' })
        });
        expect(result?.comment).toBe('purchase euros');
      });

      test('should parse posting with cost, assertion, and comment', () => {
        const line = '    assets:euros                 €100 @ $1.35 = €100  ; balance check';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:euros');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: 1.35, commodity: '$' })
        });
        expect(result?.assertion).toEqual(expect.objectContaining({ quantity: 100, commodity: '€' }));
        expect(result?.comment).toBe('balance check');
      });

      test('should parse cost with various currency formats', () => {
        const testCases = [
          {
            line: '    assets:stock    10 AAPL @ $150.50',
            expected: {
              amount: expect.objectContaining({ quantity: 10, commodity: 'AAPL' }),
              cost: { type: 'unit' as const, amount: expect.objectContaining({ quantity: 150.5, commodity: '$' }) }
            }
          },
          {
            line: '    assets:stock    10 AAPL @@ $1505',
            expected: {
              amount: expect.objectContaining({ quantity: 10, commodity: 'AAPL' }),
              cost: { type: 'total' as const, amount: expect.objectContaining({ quantity: 1505, commodity: '$' }) }
            }
          },
          {
            line: '    assets:bitcoin    0.5 BTC @ 50000 USD',
            expected: {
              amount: expect.objectContaining({ quantity: 0.5, commodity: 'BTC' }),
              cost: { type: 'unit' as const, amount: expect.objectContaining({ quantity: 50000, commodity: 'USD' }) }
            }
          }
        ];

        testCases.forEach(({ line, expected }) => {
          const result = ast.parsePosting(line);
          expect(result?.amount).toEqual(expected.amount);
          expect(result?.cost).toEqual(expected.cost);
        });
      });

      test('should parse negative amounts with cost', () => {
        const line = '    assets:euros                 €-100 @ $1.35';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: -100, commodity: '€' }));
        expect(result?.cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: 1.35, commodity: '$' })
        });
      });

      test('should parse cost with negative price', () => {
        const line = '    assets:adjustment            100 USD @ -1.5 EUR';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: 'USD' }));
        expect(result?.cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: -1.5, commodity: 'EUR' })
        });
      });

      test('should handle cost with decimal precision', () => {
        const line = '    assets:stock    100 SHARES @ $12.345';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: 'SHARES' }));
        expect(result?.cost).toEqual({
          type: 'unit',
          amount: expect.objectContaining({ quantity: 12.345, commodity: '$' })
        });
      });

      test('should not parse @ within account name as cost', () => {
        const line = '    assets:email@example.com     $100';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:email@example.com');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 100, commodity: '$' }));
        expect(result?.cost).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      test('should handle tabs for indentation', () => {
        const line = '\t\tassets:checking\t\t$100';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('assets:checking');
      });

      test('should handle mixed whitespace', () => {
        const line = '  \t  expenses:food    \t  $25.00';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.account).toBe('expenses:food');
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 25, commodity: '$' }));
      });

      test('should handle decimal-only amounts', () => {
        const line = '    expenses:misc                0.50 USD';
        const result = ast.parsePosting(line);

        expect(result).not.toBeNull();
        expect(result?.amount).toEqual(expect.objectContaining({ quantity: 0.5, commodity: 'USD' }));
      });
    });
  });

});
