import { CodeLensProvider } from '../../src/features/codeLens';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { URI } from 'vscode-uri';

describe('CodeLensProvider', () => {
  let provider: CodeLensProvider;
  let parser: HledgerParser;

  beforeEach(() => {
    provider = new CodeLensProvider();
    parser = new HledgerParser();
  });

  describe('transaction counts', () => {
    test('should show transaction count for single account', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: true
      });

      expect(lenses).toHaveLength(1); // One per transaction

      expect(lenses[0].command?.title).toContain('expenses:food: 1 tx');
      expect(lenses[0].command?.title).toContain('assets:checking: 1 tx');
      expect(lenses[0].range.start.line).toBe(0); // On transaction header line
    });

    test('should accumulate transaction counts', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50

2024-01-16 * Gas Station
    expenses:car                  $40
    assets:checking               $-40

2024-01-17 * Restaurant
    expenses:food                 $30
    assets:checking               $-30`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: true
      });

      expect(lenses).toHaveLength(3); // One per transaction

      // First transaction
      expect(lenses[0].command?.title).toContain('expenses:food: 1 tx');
      expect(lenses[0].command?.title).toContain('assets:checking: 1 tx');

      // Second transaction
      expect(lenses[1].command?.title).toContain('expenses:car: 1 tx');
      expect(lenses[1].command?.title).toContain('assets:checking: 2 tx');

      // Third transaction
      expect(lenses[2].command?.title).toContain('expenses:food: 2 tx');
      expect(lenses[2].command?.title).toContain('assets:checking: 3 tx');
    });

    test('should count each account once per transaction', () => {
      const content = `2024-01-15 * Complex Split
    expenses:food                 $30
    expenses:transport            $20
    expenses:food                 $10
    assets:checking               $-60`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: true
      });

      expect(lenses).toHaveLength(1);

      // expenses:food appears twice but should be counted once per transaction
      expect(lenses[0].command?.title).toContain('expenses:food: 1 tx');
      expect(lenses[0].command?.title).toContain('expenses:transport: 1 tx');
      expect(lenses[0].command?.title).toContain('assets:checking: 1 tx');
    });

    test('should not show code lenses when disabled', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: false
      });

      expect(lenses).toHaveLength(0);
    });

    test('should not show code lenses when settings undefined', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed);

      expect(lenses).toHaveLength(0); // Default is disabled
    });
  });

  describe('edge cases', () => {
    test('should handle empty document', () => {
      const content = '';

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: true
      });

      expect(lenses).toHaveLength(0);
    });

    test('should handle transaction with no postings', () => {
      const content = `2024-01-15 * Grocery Store`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: true
      });

      // Transaction with no postings has no accounts to count
      expect(lenses).toHaveLength(0);
    });

    test('should handle postings without amounts', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: true
      });

      // Should still show transaction counts even without amounts
      expect(lenses).toHaveLength(1);
      expect(lenses[0].command?.title).toContain('expenses:food: 1 tx');
      expect(lenses[0].command?.title).toContain('assets:checking: 1 tx');
    });
  });

  describe('command structure', () => {
    test('should have display-only command for transaction count lens', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const lenses = provider.provideCodeLenses(doc, parsed, {
        showTransactionCounts: true
      });

      expect(lenses).toHaveLength(1);

      // Transaction count lens should be display-only (empty command)
      expect(lenses[0].command?.command).toBe('');
      expect(lenses[0].command?.title).toContain('📊');
      expect(lenses[0].command?.title).toContain('tx');
    });
  });

  describe('includes', () => {
    test('should accumulate counts across included files', () => {
      // Main file
      const mainContent = `include sub.journal

2024-01-15 * Main file transaction
    expenses:food                 $50
    assets:checking               $-50`;

      const mainDoc = TextDocument.create('file:///main.journal', 'hledger', 1, mainContent);

      // Included file
      const subContent = `2024-01-10 * Sub file transaction
    expenses:food                 $30
    assets:checking               $-30`;

      const subDoc = TextDocument.create('file:///sub.journal', 'hledger', 1, subContent);

      // File reader that returns our test documents
      const fileReader = (uri: URI) => {
        const uriString = uri.toString();
        if (uriString === 'file:///main.journal') return mainDoc;
        if (uriString === 'file:///sub.journal') return subDoc;
        return null;
      };

      const parsed = parser.parse(mainDoc, {
        baseUri: URI.parse('file:///main.journal'),
        fileReader
      });

      const lenses = provider.provideCodeLenses(mainDoc, parsed, {
        showTransactionCounts: true
      });

      // Should only show lens for transaction in main.journal
      expect(lenses).toHaveLength(1);

      // Counts should accumulate across both files (sub.journal counted first by date)
      expect(lenses[0].command?.title).toContain('expenses:food: 2 tx');
      expect(lenses[0].command?.title).toContain('assets:checking: 2 tx');
    });
  });
});
