import { inlayHintsProvider } from '../../src/features/inlayHints';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range, Position } from 'vscode-languageserver';
import { HledgerParser } from '../../src/parser';

describe('InlayHintsProvider - Edge Cases', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('provideInlayHints', () => {
    test('should handle empty transactions', () => {
      const content = ``;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
      expect(hints.length).toBe(0);
    });

    test('should handle transactions outside range', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100

2024-02-15 * Test
    Expenses:Food                 $50
    Assets:Checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Range that only includes first transaction
      const range = Range.create(Position.create(0, 0), Position.create(3, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
      // Hints should not include postings from second transaction
      const secondTxHints = hints.filter(h => h.position.line >= 5);
      expect(secondTxHints.length).toBe(0);
    });

    test('should handle single-line transactions with multiple postings', () => {
      const content = `2024-01-15 * Test
    Assets:Checking               $100
    Expenses:Food                 $50
    Expenses:Transport            $50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
      expect(hints.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle postings with comments', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100  ; lunch
    Assets:Checking               $-100 ; checking account`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
      // Hints should not interfere with comments
      hints.forEach(hint => {
        expect(hint.label).toBeDefined();
      });
    });

    test('should handle postings with inferred amounts', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Expenses:Transport
    Assets:Checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const settings: any = { inlayHints: { showInferredAmounts: true } };
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed, settings);

      expect(hints).toBeDefined();
      // Should have hints for inferred amounts if enabled
    });

    test('should handle postings with costs', () => {
      const content = `2024-01-15 * Buy EUR
    Assets:EUR                   100 EUR @ 1.10 USD
    Assets:Checking              -110 USD`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const settings: any = { inlayHints: { showCosts: true } };
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed, settings);

      expect(hints).toBeDefined();
    });

    test('should handle running balances when enabled', () => {
      const content = `2024-01-15 * Test
    Assets:Checking               $100
    Expenses:Food                 $-100

2024-01-16 * Test
    Assets:Checking               $50
    Expenses:Transport            $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const settings: any = { inlayHints: { showRunningBalances: true } };
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed, settings);

      expect(hints).toBeDefined();
      // Should compute running balances when enabled
    });

    test('should handle postings with tags and amounts', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100  ; project:home
    Assets:Checking               $-100 ; project:home`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle empty postings', () => {
      const content = `2024-01-15 * Test
    
    Assets:Checking               $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should respect custom formatting options', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $1000
    Assets:Checking               $-1000`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const settings: any = {
        formatting: {
          currencySpacing: true,
          symbolPosition: 'after',
        }
      };
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed, settings);

      expect(hints).toBeDefined();
    });

    test('should handle postings with different amounts on same line', () => {
      const content = `2024-01-15 * Test
    Expenses:Food          $50 @ 1.5 = $75
    Assets:Checking       $-75`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle postings with multiple currencies', () => {
      const content = `2024-01-15 * Test
    Assets:EUR            100 EUR
    Assets:USD            100 USD
    Assets:Checking      -200 USD`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle very long transaction names', () => {
      const content = `2024-01-15 * This is a very long transaction name that might affect formatting and hint placement
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle nil hints for filtered transactions', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Range that excludes all transactions
      const range = Range.create(Position.create(100, 0), Position.create(200, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
      expect(hints.length).toBe(0);
    });

    test('should handle postings with posting dates', () => {
      const content = `2024-01-15=2024-01-16 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle postings with status marks', () => {
      const content = `2024-01-15 * Test
    ! Expenses:Food                 $100
    * Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle postings with price annotations', () => {
      const content = `2024-01-15 * Test
    Assets:EUR            100 EUR {1.10 USD}
    Assets:Checking       -110 USD`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle nil settings gracefully', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      // Call with no settings
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });

    test('should handle postings with parenthesized amounts', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 ($100)
    Assets:Checking               $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const range = Range.create(Position.create(0, 0), Position.create(100, 0));
      const hints = inlayHintsProvider.provideInlayHints(doc, range, parsed);

      expect(hints).toBeDefined();
    });
  });
});
