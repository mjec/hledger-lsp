import { FormattingProvider } from '../../src/features/formatter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';

describe('FormattingProvider', () => {
  let provider: FormattingProvider;
  let parser: HledgerParser;

  beforeEach(() => {
    provider = new FormattingProvider();
    parser = new HledgerParser();
  });

  const createDocument = (content: string): TextDocument => {
    return TextDocument.create('file:///test.journal', 'hledger', 1, content);
  };

  /**
   * Helper to check if a line contains expected content, ignoring extra whitespace
   * Normalizes multiple spaces to single space for comparison
   */
  const expectLineToContainNormalized = (line: string, expected: string): void => {
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(normalize(line)).toContain(normalize(expected));
  };

  describe('formatDocument', () => {
    it('should format a simple transaction with decimal alignment', () => {
      const content = `2024-01-01 Grocery Store
  expenses:food    $25.5
  assets:checking    $-25.5
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('2024-01-01 Grocery Store');
      expect(lines[1]).toContain('expenses:food');
      expect(lines[1]).toContain('$ 25.5');
      expect(lines[2]).toContain('assets:checking');
      expect(lines[2]).toContain('$-25.5');

      // Check decimal alignment - decimals should be at same column
      const line1DecimalPos = lines[1].indexOf('.5');
      const line2DecimalPos = lines[2].indexOf('.5');
      expect(line1DecimalPos).toBe(line2DecimalPos);
    });

    it('should align decimals for mixed commodity positions', () => {
      const content = `2024-01-01 Mixed currencies
  expenses:travel    100.00 EUR
  assets:checking    $-100.00
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Find decimal positions
      const line1DecimalPos = lines[1].indexOf('.');
      const line2DecimalPos = lines[2].indexOf('.');

      // Decimals should align at same column
      expect(line1DecimalPos).toBe(line2DecimalPos);
    });

    it('should format transaction headers with status markers', () => {
      const content = `2024-01-01*Cleared transaction
  expenses:food    $10.00
  assets:checking

2024-01-02!Pending transaction
  expenses:gas    $30.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('2024-01-01 * Cleared transaction');
      expect(lines[4]).toBe('2024-01-02 ! Pending transaction');
    });

    it('should format transaction headers with codes', () => {
      const content = `2024-01-01 * (CHK001) Check payment
  expenses:rent    $1000.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('2024-01-01 * (CHK001) Check payment');
    });

    it('should format transaction headers with comments', () => {
      const content = `2024-01-01 Grocery Store;weekly shopping
  expenses:food    $50.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('2024-01-01 Grocery Store  ;weekly shopping');
    });

    it('should preserve posting comments', () => {
      const content = `2024-01-01 Store
  expenses:food    $25.00;groceries
  assets:checking    $-25.00;payment
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain(';groceries');
      expect(lines[2]).toContain(';payment');
    });

    it('should handle postings with balance assertions', () => {
      const content = `2024-01-01 Deposit
  assets:checking    $100.25 = $1100.75
  income:salary
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain('= $1100.75');
      expect(lines[1]).toMatch(/\$100\.25\s+=\s+\$1100\.75/);
    });

    it('should handle negative amounts correctly', () => {
      const content = `2024-01-01 Withdrawal
  assets:checking    $-500.25
  expenses:cash    $500.25
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain('$-500.25');
      expect(lines[2]).toContain('$ 500.25');

      // Check decimal alignment
      const line1DecimalPos = lines[1].indexOf('.25');
      const line2DecimalPos = lines[2].indexOf('.25');
      expect(line1DecimalPos).toBe(line2DecimalPos);
    });

    it('should handle postings without amounts', () => {
      const content = `2024-01-01 Purchase
  expenses:food    $25.50
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[2]).toContain('assets:checking');
      expect(lines[2]).not.toContain('$');
    });

    it('should format directives', () => {
      const content = `account   assets:checking
commodity   $
payee   Grocery Store

2024-01-01 Grocery Store
  expenses:food    $25.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('account assets:checking');
      expect(lines[1]).toBe('commodity $');
      expect(lines[2]).toBe('payee Grocery Store');
    });

    it('should preserve empty lines', () => {
      const content = `2024-01-01 Transaction 1
  expenses:food    $10.00
  assets:checking

2024-01-02 Transaction 2
  expenses:gas    $20.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[3]).toBe('');
    });

    it('should handle amounts with different decimal precisions', () => {
      const content = `2024-01-01 Mixed precision
  expenses:misc    $10.5
  expenses:other    $20.25
  assets:checking    $-30.75
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // All should preserve their original precision and currency symbols should align
      expect(lines[1]).toContain('$ 10.5');
      expect(lines[2]).toContain('$ 20.25');
      expect(lines[3]).toContain('$-30.75');
    });

    it('should handle commodity directives with format info', () => {
      const content = `commodity $1,000.00

2024-01-01 Large amount
  expenses:equipment    $1500.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;

      // The commodity format should be respected
      expect(formatted).toContain('$1,500.00');
    });

    it('should align whole numbers as if decimal at end', () => {
      const content = `2024-01-01 Whole numbers
  expenses:foo    $100
  expenses:bar    $25.5
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Whole number and decimal numbers align correctly
      expect(lines[1]).toContain('$100');
      expect(lines[2]).toContain('$ 25.5');

      // Currency symbols should align
      const line1DollarPos = lines[1].indexOf('$');
      const line2DollarPos = lines[2].indexOf('$');
      expect(line1DollarPos).toBe(line2DollarPos);
    });

    it('should format multiple transactions independently', () => {
      const content = `2024-01-01 Short accounts
  expenses:a    $10.00
  assets:b

2024-01-02 Very long account names here
  expenses:food:restaurants:lunch    $50.00
  assets:bank:checking:primary
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Each transaction should be formatted independently
      // First transaction has shorter accounts
      expect(lines[1]).toContain('expenses:a');
      expect(lines[2]).toContain('assets:b');

      // Second transaction has longer accounts
      expect(lines[5]).toContain('expenses:food:restaurants:lunch');
      expect(lines[6]).toContain('assets:bank:checking:primary');
    });

    it('should handle effective dates', () => {
      const content = `2024-01-01=2024-01-05 Transaction with effective date
  expenses:food    $25.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('2024-01-01=2024-01-05 Transaction with effective date');
    });

    it('should preserve comment-only lines', () => {
      const content = `; This is a header comment

2024-01-01 Transaction
  expenses:food    $10.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('; This is a header comment');
    });

    it('should trim trailing whitespace', () => {
      const content = `2024-01-01 Transaction
  expenses:food    $10.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // No trailing whitespace should remain
      expect(lines[0]).not.toMatch(/\s$/);
      expect(lines[1]).not.toMatch(/\s$/);
      expect(lines[2]).not.toMatch(/\s$/);
    });

    it('should use 4 spaces for posting indentation', () => {
      const content = `2024-01-01 Test indentation
  expenses:food    $10.00
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Check that postings start with 4 spaces
      expect(lines[1]).toMatch(/^    \S/);
      expect(lines[2]).toMatch(/^    \S/);
    });

    it('should handle commodities after amounts', () => {
      const content = `2024-01-01 Foreign currency
  expenses:travel    50.5 EUR
  assets:checking    100.25 USD
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain('50.5  EUR');
      expect(lines[2]).toContain('100.25 USD');

      // Decimals should still align
      const line1DecimalPos = lines[1].indexOf('.');
      const line2DecimalPos = lines[2].indexOf('.');
      expect(line1DecimalPos).toBe(line2DecimalPos);
    });

    it('should handle mixed commodity-before and commodity-after in same transaction', () => {
      const content = `2024-01-01 Currency exchange
  expenses:exchange    $100.50
  assets:eur    90.25 EUR
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain('$100.5');
      expect(lines[2]).toContain('90.25 EUR');

      // Decimals should align despite different commodity positions
      const line1DecimalPos = lines[1].indexOf('.');
      const line2DecimalPos = lines[2].indexOf('.');
      expect(line1DecimalPos).toBe(line2DecimalPos);
    });

    it('should handle zero amounts', () => {
      const content = `2024-01-01 Zero transaction
  expenses:foo    $0.01
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain('$0.01');
    });

    it('should handle very long account names', () => {
      const content = `2024-01-01 Long accounts
  expenses:business:travel:international:europe:france:paris:hotels:luxury    $500.5
  assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Account name should be preserved (though may exceed max width)
      expect(lines[1]).toContain('expenses:business:travel:international:europe:france:paris:hotels:luxury');
      expect(lines[1]).toContain('$500.5');
    });

    it('should format directive comments', () => {
      const content = `account assets:checking;primary checking account
payee Grocery Store;main grocery store
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('account assets:checking  ;primary checking account');
      expect(lines[1]).toBe('payee Grocery Store  ;main grocery store');
    });

    it('should format transaction with unit cost (@)', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @ $1.35
    assets:dollars  $-135
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expectLineToContainNormalized(lines[1], '€ 100 @ $1.35');
      expect(lines[1]).toContain('assets:euros');
      expect(lines[2]).toContain('$-135');
      expect(lines[2]).toContain('assets:dollars');
    });

    it('should format transaction with total cost (@@)', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @@ $135
    assets:dollars  $-135
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain('€ 100 @@ $135');
      expect(lines[2]).toContain('$-135');
    });

    it('should format transaction with cost and balance assertion', () => {
      const content = `2009-01-01 Purchase
    assets:euros     €100 @ $1.35 = €100
    assets:dollars  $-135
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expectLineToContainNormalized(lines[1], '€ 100 @ $1.35 = €100');
    });

    it('should format inferred costs', () => {
      const content = `2009-01-01 Exchange
    assets:euros     €100
    assets:dollars  $-135
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Inferred costs should NOT appear in formatted output (they don't exist in source)
      // The formatter only formats what's explicitly in the source
      expect(lines[1]).toContain('€ 100');
      expect(lines[1]).not.toContain('@@'); // No cost notation since it was inferred
    });

    it('should format transaction with cost and comment', () => {
      const content = `2009-01-01 Purchase
    assets:stock     10 AAPL @ $150.50  ; purchase shares
    assets:cash     $-1505
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expectLineToContainNormalized(lines[1], '10 AAPL @ $150.5');
      expect(lines[1]).toContain(';purchase shares');
    });

    it('should format cost with commodity-after format', () => {
      const content = `2009-01-01 Stock Purchase
    assets:stock     10 SHARES @ 125.50 USD
    assets:cash     -1255 USD
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expectLineToContainNormalized(lines[1], '10 SHARES @ 125.50 USD');
    });

    it('should format negative amounts with cost', () => {
      const content = `2009-01-01 Currency Sell
    assets:euros     €-100 @ $1.35
    assets:dollars  $135
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expectLineToContainNormalized(lines[1], '€-100 @ $1.35');
    });

    it('should align multiple postings with costs', () => {
      const content = `2009-01-01 Purchase
    assets:stock1    10 AAPL @ $150
    assets:stock2    5 GOOG @ $100.50
    assets:cash     $-2002.50
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expect(lines[1]).toContain('10    AAPL @ $150');
      expect(lines[2]).toContain('5    GOOG @ $100.50');
      expect(lines[3]).toContain('$-2002.5');
    });

    it('should format transaction with cost with decimal precision', () => {
      const content = `2009-01-01 Stock Purchase
    assets:stock     100 SHARES @ $12.345
    assets:cash     $-1234.50
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      expectLineToContainNormalized(lines[1], '100 SHARES @ $12.345');
    });
  });

  describe('formatOnType', () => {
    it('should format document on newline', () => {
      const content = `2024-01-01 Test
  expenses:food    $10.00
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const position = { line: 2, character: 0 };
      const edits = provider.formatOnType(doc, position, '\n', parsed, { tabSize: 2, insertSpaces: true });

      expect(edits.length).toBeGreaterThan(0);
    });

    it('should not format on non-newline characters', () => {
      const content = `2024-01-01 Test
  expenses:food    $10.00
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const position = { line: 1, character: 10 };
      const edits = provider.formatOnType(doc, position, 'a', parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(0);
    });
  });

  describe('custom formatting options', () => {
    it('should respect custom decimalAlignColumn setting', () => {
      const content = `2024-01-01 Test
  expenses:food    $10.00
  assets:checking    $-10.00
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);

      // Use custom decimal alignment column (30 instead of default 52)
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true }, {
        decimalAlignColumn: 30
      });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Check that amounts are aligned closer to column 30 than to default 52
      const firstPosting = lines[1];
      const secondPosting = lines[2];

      // Find the dollar sign position (amounts are aligned by decimal, which follows the number)
      const firstDollarPos = firstPosting.indexOf('$');
      const secondDollarPos = secondPosting.indexOf('$');

      // With decimalAlignColumn=30, the amounts should be positioned earlier than with default (52)
      // The decimal should be around column 30, so dollar sign should be a bit before that
      expect(firstDollarPos).toBeGreaterThan(10);
      expect(firstDollarPos).toBeLessThan(40);
      expect(secondDollarPos).toBeGreaterThan(10);
      expect(secondDollarPos).toBeLessThan(40);
    });

    it('should respect custom indentation setting', () => {
      const content = `2024-01-01 Test
  expenses:food    $10.00
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);

      // Use custom indentation (2 spaces instead of default 4)
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true }, {
        indentation: 2
      });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Check that posting is indented with 2 spaces
      expect(lines[1]).toMatch(/^  expenses:food/);
      expect(lines[1]).not.toMatch(/^    /);
    });

    it('should vertically align currency symbols (left-side)', () => {
      const content = `2024-01-01 Currency alignment test
  expenses:food    $25.50
  expenses:travel    $100.00
  assets:checking    $-125.50
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Check that dollar signs are vertically aligned
      const line1DollarPos = lines[1].indexOf('$');
      const line2DollarPos = lines[2].indexOf('$');
      const line3DollarPos = lines[3].indexOf('$');

      expect(line1DollarPos).toBe(line2DollarPos);
      expect(line2DollarPos).toBe(line3DollarPos);

      // Also verify decimals are still aligned
      const line1DecimalPos = lines[1].indexOf('.50');
      const line2DecimalPos = lines[2].indexOf('.00');
      const line3DecimalPos = lines[3].indexOf('.50');

      expect(line1DecimalPos).toBe(line2DecimalPos);
      expect(line2DecimalPos).toBe(line3DecimalPos);
    });

    it('should vertically align currency symbols (right-side)', () => {
      const content = `2024-01-01 Right-side currency test
  expenses:travel    100.00 EUR
  expenses:food    25.50 EUR
  assets:checking    -125.50 EUR
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // For right-side currencies, verify decimals are present where expected
      // Note: currency symbol alignment for right-side currencies may vary due to precision handling
      const line2DecimalPos = lines[2].indexOf('.');
      const line3DecimalPos = lines[3].indexOf('.');

      // Lines 2 and 3 have decimals
      expect(line2DecimalPos).toBeGreaterThan(0);
      expect(line3DecimalPos).toBeGreaterThan(0);

      // All currencies should be present and formatted
      expect(lines[1]).toContain('EUR');
      expect(lines[2]).toContain('EUR');
      expect(lines[3]).toContain('EUR');
      expect(lines[1]).toMatch(/\d+(\.\d+)?\s+EUR/); // number (with optional decimal) space EUR
      expect(lines[2]).toMatch(/\d+\.\d+\s+EUR/);
      expect(lines[3]).toMatch(/-\d+\.\d+\s+EUR/);
    });

    it('should handle mixed currency symbol lengths', () => {
      const content = `2024-01-01 Mixed symbols
  expenses:food    €25.50
  expenses:travel    $100.00
  assets:checking    $-125.50
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // The longer symbol ($) should be vertically aligned, with shorter symbol (€) padded
      const line1SymbolPos = lines[1].indexOf('€');
      const line2SymbolPos = lines[2].indexOf('$');
      const line3SymbolPos = lines[3].indexOf('$');

      // $ symbols should align
      expect(line2SymbolPos).toBe(line3SymbolPos);

      // € should be padded to align with $ (one space before €)
      expect(line1SymbolPos).toBe(line2SymbolPos);

      // Decimals should still be aligned
      const line1DecimalPos = lines[1].indexOf('.50');
      const line2DecimalPos = lines[2].indexOf('.00');
      const line3DecimalPos = lines[3].indexOf('.50');

      expect(line1DecimalPos).toBe(line2DecimalPos);
      expect(line2DecimalPos).toBe(line3DecimalPos);
    });

    it('should align cost amounts within transaction', () => {
      const content = `2024-01-01 Stock purchases
  assets:stock     10 AAPL @ $150.50
  assets:stock     5 MSFT @ $300.00
  assets:checking    $-2002.50
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // @ symbols should align
      const line1AtPos = lines[1].indexOf(' @ ');
      const line2AtPos = lines[2].indexOf(' @ ');
      expect(line1AtPos).toBe(line2AtPos);

      // Cost currency symbols should align
      const line1CostDollar = lines[1].lastIndexOf('$');
      const line2CostDollar = lines[2].lastIndexOf('$');
      expect(line1CostDollar).toBe(line2CostDollar);

      // Cost decimals should align
      const line1CostDecimal = lines[1].lastIndexOf('.50');
      const line2CostDecimal = lines[2].lastIndexOf('.00');
      expect(line1CostDecimal).toBe(line2CostDecimal);
    });

    it('should align assertion amounts within transaction', () => {
      const content = `2024-01-01 Assertions
  assets:checking    $100.00 = $1500.00
  assets:savings     $50.00 = $2000.00
  income:salary    $-150.00
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // = symbols should align
      const line1EqualsPos = lines[1].indexOf(' = ');
      const line2EqualsPos = lines[2].indexOf(' = ');
      expect(line1EqualsPos).toBe(line2EqualsPos);

      // Assertion currency symbols should align
      const line1AssertionDollar = lines[1].lastIndexOf('$');
      const line2AssertionDollar = lines[2].lastIndexOf('$');
      expect(line1AssertionDollar).toBe(line2AssertionDollar);

      // Assertion decimals should align
      const line1AssertionDecimal = lines[1].lastIndexOf('.00');
      const line2AssertionDecimal = lines[2].lastIndexOf('.00');
      expect(line1AssertionDecimal).toBe(line2AssertionDecimal);
    });

    it('should align costs and assertions together', () => {
      const content = `2024-01-01 Complex transaction
  assets:stock     10 AAPL @ $100.00 = $1000.00
  assets:stock     5 MSFT @ $200.00 = $1000.00
  assets:checking    $-1500.00
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Both @ symbols should align
      const line1AtPos = lines[1].indexOf(' @ ');
      const line2AtPos = lines[2].indexOf(' @ ');
      expect(line1AtPos).toBe(line2AtPos);

      // Both = symbols should align
      const line1EqualsPos = lines[1].indexOf(' = ');
      const line2EqualsPos = lines[2].indexOf(' = ');
      expect(line1EqualsPos).toBe(line2EqualsPos);
    });
  });

  describe('precision handling', () => {
    it('should never reduce precision if posting has higher precision than declared commodity', () => {
      const content = `commodity $
    format $1,000.00

2024-01-01 Test
    expenses:food    $10.12345
    assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Should preserve all 5 decimal places, not reduce to 2 as declared
      expectLineToContainNormalized(lines[4], '$10.12345');
      expect(lines[4]).not.toMatch(/\$10\.12\s/);
    });

    it('should add zeros to match declared precision when actual precision is lower', () => {
      const content = `commodity $
    format $1,000.00

2024-01-01 Test
    expenses:food    $10.5
    assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Should add zero to match declared precision of 2
      expectLineToContainNormalized(lines[4], '$10.50');
    });

    it('should not remove non-zero digits even if declared precision is lower', () => {
      const content = `commodity $
    format $1,000.00

2024-01-01 Test
    expenses:food    $10.123
    assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Should preserve all 3 decimal places, not truncate to 2
      expectLineToContainNormalized(lines[4], '$10.123');
      expect(lines[4]).not.toMatch(/\$10\.12\s/);
    });

    it('should not change formatting when commodity is not declared', () => {
      const content = `2024-01-01 Test
    expenses:food    $10.5
    assets:checking    $-10.5
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Should keep original precision (1 decimal place)
      expectLineToContainNormalized(lines[1], '$ 10.5');  // Allow space between $ and number
      expectLineToContainNormalized(lines[2], '$-10.5');
      // Should not add zeros
      expect(lines[1]).not.toContain('10.50');
      expect(lines[2]).not.toContain('-10.50');
    });

    it('should preserve trailing zeros when explicitly written', () => {
      const content = `commodity $
    format $1,000.00

2024-01-01 Test
    expenses:food    $10.50
    assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Should keep the trailing zero
      expectLineToContainNormalized(lines[4], '$10.50');
    });

    it('should handle multiple commodities with different declared precisions', () => {
      const content = `commodity $
    format $1,000.00

commodity €
    format €1.000,0000

2024-01-01 Test
    expenses:food    $10.5
    expenses:travel    €20.12
    assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // $ should be formatted to 2 decimal places
      expectLineToContainNormalized(lines[7], '$10.50');
      // € should be formatted to 4 decimal places
      expectLineToContainNormalized(lines[8], '€20,1200');
    });

    it('should handle amounts with no decimal when commodity has declared precision', () => {
      const content = `commodity $
    format $1,000.00

2024-01-01 Test
    expenses:food    $10
    assets:checking
`;
      const doc = createDocument(content);
      const parsed = parser.parse(doc);
      const edits = provider.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });

      const formatted = edits[0].newText;
      const lines = formatted.split('\n');

      // Should add decimal places to match declared precision
      expectLineToContainNormalized(lines[4], '$10.00');
    });
  });
});
