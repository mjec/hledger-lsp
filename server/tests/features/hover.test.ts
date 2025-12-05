import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';
import { hoverProvider } from '../../src/features/hover';

describe('HoverProvider', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('basic hover (without parsed data)', () => {
    test('returns account hover for account-like token', () => {
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, '    assets:bank  $100');
      const hover = hoverProvider.provideHover(doc, 0, 12);
      expect(hover).not.toBeNull();
      expect(hover?.contents).toBeDefined();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Account');
      expect(value).toContain('assets:bank');
    });

    test('returns date hover for date token', () => {
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, '2023-05-01 Payee');
      const hover = hoverProvider.provideHover(doc, 0, 4);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Date');
    });
  });

  describe('date hover', () => {
    test('shows formatted date with day of week', () => {
      const content = '2024-01-15 * Transaction\n    expenses:food  $50.00\n    assets:checking';
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over date (position 5 is in the middle of the date)
      const hover = hoverProvider.provideHover(doc, 0, 5, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Date');
      expect(value).toContain('Monday'); // 2024-01-15 was a Monday
      expect(value).toContain('January');
      expect(value).toContain('2024');
    });

    test('handles slash-separated dates', () => {
      const content = '2024/06/20 * Transaction\n    expenses:food  $50.00\n    assets:checking';
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over date (position 5 is in the middle)
      const hover = hoverProvider.provideHover(doc, 0, 5, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Date');
      expect(value).toContain('June');
    });
  });

  describe('account hover', () => {
    test('shows declared account with type and location', () => {
      const content = `account assets:checking  ; Main checking

2024-01-15 * Transaction
    assets:checking  $50.00
    expenses:food`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over assets:checking in posting
      const hover = hoverProvider.provideHover(doc, 3, 10, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Account');
      expect(value).toContain('assets:checking');
      expect(value).toContain('Declared');
      expect(value).toContain('Location');
      expect(value).toContain('test.journal:1');
    });

    test('shows undeclared account status', () => {
      const content = `2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const hover = hoverProvider.provideHover(doc, 1, 10, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Undeclared');
      expect(value).toContain('inferred from usage');
    });

    test('shows account usage count', () => {
      const content = `2024-01-15 * Transaction 1
    expenses:food  $50.00
    assets:checking

2024-01-16 * Transaction 2
    expenses:food  $30.00
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const hover = hoverProvider.provideHover(doc, 1, 10, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Usage');
      expect(value).toContain('2 postings');
    });
  });

  describe('commodity hover', () => {
    test('shows commodity format information for alphanumeric commodity', () => {
      const content = `commodity 1,000.00 USD

2024-01-15 * Transaction
    expenses:food  50.00 USD
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Find position of USD in posting line
      const lines = content.split('\n');
      const postingLine = lines[3];
      const usdPos = postingLine.indexOf('USD');
      const hover = hoverProvider.provideHover(doc, 3, usdPos + 1, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Commodity');
      expect(value).toContain('USD');
      expect(value).toContain('Format');
      expect(value).toContain('Symbol position');
      expect(value).toContain('Decimal mark');
    });

    test('shows declared commodity status', () => {
      const content = `commodity EUR

2024-01-15 * Transaction
    expenses:food  50.00 EUR
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Find position of EUR in posting line
      const lines = content.split('\n');
      const postingLine = lines[3];
      const eurPos = postingLine.indexOf('EUR');
      const hover = hoverProvider.provideHover(doc, 3, eurPos + 1, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Commodity');
      expect(value).toContain('EUR');
      expect(value).toContain('Declared');
    });

    test('shows undeclared commodity', () => {
      const content = `2024-01-15 * Transaction
    expenses:food  50.00 GBP
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Find position of GBP in posting line
      const lines = content.split('\n');
      const postingLine = lines[1];
      const gbpPos = postingLine.indexOf('GBP');
      const hover = hoverProvider.provideHover(doc, 1, gbpPos + 1, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Commodity');
      expect(value).toContain('GBP');
      expect(value).toContain('Undeclared');
    });
  });

  describe('payee hover', () => {
    test('shows declared payee with location', () => {
      const content = `payee Grocery Store

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over "Grocery" in transaction header
      const lines = content.split('\n');
      const headerLine = lines[2]; // '2024-01-15 * Grocery Store'
      const groceryPos = headerLine.indexOf('Grocery');
      const hover = hoverProvider.provideHover(doc, 2, groceryPos + 3, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Payee');
      expect(value).toContain('Grocery Store');
      expect(value).toContain('Declared');
      expect(value).toContain('Location');
      expect(value).toContain('test.journal:1');
    });

    test('shows transaction count for payee', () => {
      const content = `payee Grocery Store

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking

2024-01-16 * Grocery Store
    expenses:food  $30.00
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over "Grocery" in transaction header
      const lines = content.split('\n');
      const headerLine = lines[2];
      const groceryPos = headerLine.indexOf('Grocery');
      const hover = hoverProvider.provideHover(doc, 2, groceryPos + 3, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Transactions');
      expect(value).toContain('2');
    });
  });

  describe('tag hover', () => {
    test('shows declared tag with location', () => {
      const content = `tag trip

2024-01-15 * Transaction  ; trip:paris
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over tag name in comment
      const lines = content.split('\n');
      const headerLine = lines[2]; // '2024-01-15 * Transaction  ; trip:paris'
      const tripPos = headerLine.lastIndexOf('trip');
      const hover = hoverProvider.provideHover(doc, 2, tripPos + 2, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Tag');
      expect(value).toContain('trip');
      expect(value).toContain('Declared');
      expect(value).toContain('Location');
    });

    test('shows tag usage count', () => {
      const content = `2024-01-15 * Transaction  ; trip:paris
    expenses:food  $50.00
    assets:checking  ; trip:london

2024-01-16 * Transaction  ; trip:rome
    expenses:food  $30.00
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over tag name in comment
      const lines = content.split('\n');
      const headerLine = lines[0];
      const tripPos = headerLine.indexOf('trip');
      const hover = hoverProvider.provideHover(doc, 0, tripPos + 2, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Usage');
      expect(value).toContain('3');
    });
  });

  describe('transaction hover', () => {
    test('shows transaction details with totals', () => {
      const content = `2024-01-15 * (CODE123) Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover over transaction header
      const hover = hoverProvider.provideHover(doc, 0, 20, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Transaction');
      expect(value).toContain('Grocery Store');
      expect(value).toContain('Status');
      expect(value).toContain('Cleared');
      expect(value).toContain('Code');
      expect(value).toContain('CODE123');
      expect(value).toContain('Totals');
      expect(value).toContain('$0.00');
      expect(value).toContain('Postings');
      expect(value).toContain('2');
    });

    test('shows multi-commodity transaction totals', () => {
      const content = `2024-01-15 * Currency Exchange
    assets:usd  $100.00
    assets:eur  €-90.00
    equity:conversion`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Hover on the status marker (*) at position 13
      const hover = hoverProvider.provideHover(doc, 0, 13, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Totals');
      expect(value).toContain('$100.00');
      expect(value).toContain('-€90.00');
    });

    test('shows pending transaction status', () => {
      const content = `2024-01-15 ! Pending Payment
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const hover = hoverProvider.provideHover(doc, 0, 20, parsed);

      expect(hover).not.toBeNull();
      const value = (hover?.contents as any)?.value || '';
      expect(value).toContain('Pending');
    });
  });

  describe('edge cases', () => {
    test('returns null for empty token', () => {
      const content = '   ';
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const hover = hoverProvider.provideHover(doc, 0, 1, parsed);

      expect(hover).toBeNull();
    });

    test('handles hover on unknown token', () => {
      const content = 'unknown-token';
      const doc = TextDocument.create('file://test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const hover = hoverProvider.provideHover(doc, 0, 5, parsed);

      // Should return null for tokens that don't match any category
      expect(hover).toBeNull();
    });
  });
});
