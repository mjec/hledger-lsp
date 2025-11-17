import { InlayHintsProvider } from '../../src/features/inlayHints';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range, InlayHintKind } from 'vscode-languageserver';
import { parser } from '../../src/parser';

// Helper to convert InlayHint label to string
function labelToString(label: string | any[]): string {
  return typeof label === 'string' ? label : '';
}

describe('InlayHintsProvider', () => {
  let provider: InlayHintsProvider;

  beforeEach(() => {
    provider = new InlayHintsProvider();
  });

  describe('inferred amount hints', () => {
    test('should show inferred amount for posting without amount', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toBe('  $-50.00');
      expect(hints[0].kind).toBe(InlayHintKind.Parameter);
      expect(hints[0].position.line).toBe(2);
    });

    test('should show inferred amount for multiple commodities', () => {
      const content = `2024-01-15 * Exchange
    assets:checking               $-100
    expenses:fees                 $5
    assets:euros`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 3, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toBe('  $95.00');
      expect(hints[0].position.line).toBe(3);
    });

    test('should calculate inferred amount with costs', () => {
      const content = `2024-01-15 * Stock Purchase
    assets:stock                  10 AAPL @ $100
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toBe('  $-1000.00');
      expect(hints[0].position.line).toBe(2);
    });

    test('should calculate inferred amount with total cost', () => {
      const content = `2024-01-15 * Currency Exchange
    assets:euros                  €100 @@ $135
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toBe('  $-135.00');
      expect(hints[0].position.line).toBe(2);
    });

    test('should not show hints when all postings have amounts', () => {
      const content = `2024-01-15 * Transfer
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(0);
    });

    test('should not show hints when showInferredAmounts is false', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(0);
    });
  });

  describe('running balance hints', () => {
    test('should show running balance for postings with amounts', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: true,
        showCostConversions: false
      });

      expect(hints).toHaveLength(2);
      expect(hints[0].label).toContain('balance: $50.00');
      expect(hints[0].kind).toBe(InlayHintKind.Type);
      expect(hints[1].label).toContain('balance: $-50.00');
    });

    test('should show balance before comment', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50  ; groceries
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: true,
        showCostConversions: false
      });

      expect(hints).toHaveLength(2);
      // Balance hint should appear at or before the comment
      const line = doc.getText().split('\n')[1];
      const commentPos = line.indexOf(';');
      expect(hints[0].position.character).toBeLessThanOrEqual(commentPos);
    });

    test('should not show running balance when disabled', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(0);
    });
  });

  describe('cost conversion hints', () => {
    test('should show total cost for unit cost', () => {
      const content = `2024-01-15 * Stock Purchase
    assets:stock                  10 AAPL @ $100
    assets:checking               $-1000`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: true
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toBe(' = $1000.00');
      expect(hints[0].kind).toBe(InlayHintKind.Type);
      expect(hints[0].position.line).toBe(1);
    });

    test('should show total cost for total cost notation', () => {
      const content = `2024-01-15 * Currency Exchange
    assets:euros                  €100 @@ $135
    assets:checking               $-135`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: true
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toBe(' = $135.00');
      expect(hints[0].position.line).toBe(1);
    });

    test('should handle multiple postings with costs', () => {
      const content = `2024-01-15 * Multiple Purchases
    assets:stock                  10 AAPL @ $100
    assets:crypto                 0.5 BTC @ $50000
    assets:checking               $-26000`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 3, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: true
      });

      expect(hints).toHaveLength(2);
      expect(hints[0].label).toBe(' = $1000.00');
      expect(hints[1].label).toBe(' = $25000.00');
    });

    test('should not show hints when showCostConversions is false', () => {
      const content = `2024-01-15 * Stock Purchase
    assets:stock                  10 AAPL @ $100
    assets:checking               $-1000`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(0);
    });
  });

  describe('range filtering', () => {
    test('should only show hints for transactions within range', () => {
      const content = `2024-01-15 * First Transaction
    expenses:food                 $50
    assets:checking

2024-01-16 * Second Transaction
    expenses:rent                 $1000
    assets:checking

2024-01-17 * Third Transaction
    expenses:utilities            $75
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Only request hints for second transaction (lines 4-6)
      const range = Range.create(4, 0, 6, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].position.line).toBe(6);
      expect(hints[0].label).toBe('  $-1000.00');
    });

    test('should handle empty range', () => {
      const content = `2024-01-15 * Transaction
    expenses:food                 $50
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(10, 0, 20, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(0);
    });
  });

  describe('combined hints', () => {
    test('should show all hint types when all enabled', () => {
      const content = `2024-01-15 * Stock Purchase
    assets:stock                  10 AAPL @ $100
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: true,
        showCostConversions: true
      });

      // Should have: 1 cost conversion, 1 running balance, 1 inferred amount
      expect(hints.length).toBeGreaterThanOrEqual(2);

      const costHint = hints.find(h => labelToString(h.label).includes('='));
      const inferredHint = hints.find(h => labelToString(h.label).includes('-1000'));

      expect(costHint).toBeDefined();
      expect(inferredHint).toBeDefined();
    });

    test('should use default settings when not provided', () => {
      const content = `2024-01-15 * Stock Purchase
    assets:stock                  10 AAPL @ $100
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed);

      // Default: showInferredAmounts: true, showRunningBalances: false, showCostConversions: true
      const inferredHint = hints.find(h => labelToString(h.label).includes('-1000'));
      const costHint = hints.find(h => labelToString(h.label).includes('='));
      const balanceHint = hints.find(h => labelToString(h.label).includes('balance:'));

      expect(inferredHint).toBeDefined();
      expect(costHint).toBeDefined();
      expect(balanceHint).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    test('should handle transaction without postings', () => {
      const content = `2024-01-15 * Empty Transaction`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 0, 0);

      const hints = provider.provideInlayHints(doc, range, parsed);

      expect(hints).toHaveLength(0);
    });

    test('should handle commodityless amounts', () => {
      const content = `2024-01-15 * No Commodity
    expenses:food                 50
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: true,
        showRunningBalances: false,
        showCostConversions: false
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toBe('  -50.00');
    });

    test('should handle inferred costs', () => {
      const content = `2024-01-15 * Inferred Cost
    assets:euros                  €100
    assets:checking               $-135`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: true
      });

      // Inferred costs don't have explicit @ notation in text,
      // so no cost conversion hints should be shown
      expect(hints).toHaveLength(0);
    });

    test('should handle commodity-before format', () => {
      const content = `2024-01-15 * Purchase
    assets:stock                  10 AAPL @ $100
    assets:checking               $-1000`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        showInferredAmounts: false,
        showRunningBalances: false,
        showCostConversions: true
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].label).toContain('$');
    });
  });
});
