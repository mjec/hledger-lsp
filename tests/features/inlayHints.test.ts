import { URI } from 'vscode-uri';
import { InlayHintsProvider } from '../../src/features/inlayHints';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range, InlayHintKind, InlayHintLabelPart } from 'vscode-languageserver';
import { parser } from '../../src/parser';

// Helper to convert InlayHint label to string
function labelToString(label: string | InlayHintLabelPart[]): string {
  if (typeof label === 'string') {
    return label;
  }
  // If it's an array of InlayHintLabelPart, concatenate the values
  return label.map(part => part.value).join('');
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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(1);
      expect(labelToString(hints[0].label)).toContain('$-50');
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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(1);
      expect(labelToString(hints[0].label)).toContain('$95');
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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(1);
      expect(labelToString(hints[0].label)).toContain('$-1000');
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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(1);
      expect(labelToString(hints[0].label)).toContain('$-135');
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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

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
        inlayHints: {
          showInferredAmounts: false,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

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
        inlayHints: {
          showInferredAmounts: false,
          showRunningBalances: true,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(2);
      // Running balance shows cumulative balance per account
      expect(labelToString(hints[0].label)).toContain('$50');  // expenses:food balance after this transaction
      expect(hints[0].kind).toBe(InlayHintKind.Type);
      expect(labelToString(hints[1].label)).toContain('$-50'); // assets:checking balance after this transaction
    });

    test('should not show running balance when disabled', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        inlayHints: {
          showInferredAmounts: false,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(0);
    });

    test('should not show running balance when posting has balance assertion', () => {
      const content = `2024-01-15 * Withdraw
    assets:checking               $-200.00 = $800.00
    expenses:cash                 $200.00`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 2, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        inlayHints: {
          showInferredAmounts: false,
          showRunningBalances: true,
          showCostConversions: false
        }
      } as any);

      // Should only show hint for expenses:cash, not for assets:checking (has assertion)
      expect(hints).toHaveLength(1);
      expect(labelToString(hints[0].label)).toContain('$200');
      expect(hints[0].position.line).toBe(2); // expenses:cash line
    });

    test('should accumulate balances across multiple transactions', () => {
      const content = `2024-01-15 * Initial deposit
    assets:checking               $1000
    equity:opening

2024-01-16 * Grocery Store
    expenses:food                 $50
    assets:checking               $-50

2024-01-17 * Gas Station
    expenses:gas                  $40
    assets:checking               $-40`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 12, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        inlayHints: {
          showInferredAmounts: false,
          showRunningBalances: true,
          showCostConversions: false
        }
      } as any);

      // Should have 6 hints (including equity:opening which now shows balance even with inferred amount)
      expect(hints).toHaveLength(6);

      // First transaction: checking = $1000, equity:opening = $-1000 (inferred)
      expect(labelToString(hints[0].label)).toContain('$1000');
      expect(labelToString(hints[1].label)).toContain('$-1000'); // equity:opening balance (inferred amount)

      // Second transaction: food = $50, checking = $950 (1000 - 50)
      expect(labelToString(hints[2].label)).toContain('$50');  // expenses:food first occurrence
      expect(labelToString(hints[3].label)).toContain('$950'); // assets:checking cumulative (running balance!)

      // Third transaction: gas = $40, checking = $910 (950 - 40)
      expect(labelToString(hints[4].label)).toContain('$40');  // expenses:gas first occurrence
      expect(labelToString(hints[5].label)).toContain('$910'); // assets:checking cumulative (running balance!)
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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(1);
      expect(hints[0].position.line).toBe(6);
      expect(labelToString(hints[0].label)).toContain('$-1000');
    });

    test('should handle empty range', () => {
      const content = `2024-01-15 * Transaction
    expenses:food                 $50
    assets:checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(10, 0, 20, 0);

      const hints = provider.provideInlayHints(doc, range, parsed, {
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: true,
          showCostConversions: true
        }
      } as any);

      // Should have: 1 cost conversion (@@), 1 running balance (stock), 1 inferred amount (checking)
      expect(hints.length).toBeGreaterThanOrEqual(2);

      const costHint = hints.find(h => labelToString(h.label).includes('@@'));
      const inferredHint = hints.find(h => labelToString(h.label).includes('-$1000') || labelToString(h.label).includes('$-1000'));

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

      // Default: all hints disabled by default
      expect(hints).toHaveLength(0);
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
        inlayHints: {
          showInferredAmounts: true,
          showRunningBalances: false,
          showCostConversions: false
        }
      } as any);

      expect(hints).toHaveLength(1);
      expect(labelToString(hints[0].label)).toContain('-50.00');
    });



  });

  describe('includes', () => {
    test('should accumulate running balances across included files', () => {
      const otherContent = `; Included file
2024-01-15 * First Transaction
    assets:checking                $-50
    expenses:food                  $50`;

      const baseContent = `; Base file that includes another file
include balance-include-other.journal

2024-01-16 * Second Transaction
    assets:checking                $-40
    expenses:gas                   $40`;

      const otherUri = URI.parse('file:///home/patrick/Development/hledger_lsp/server/tests/fixtures/balance-include-other.journal');
      const baseUri = URI.parse('file:///home/patrick/Development/hledger_lsp/server/tests/fixtures/balance-include-base.journal');

      const otherDoc = TextDocument.create(otherUri.toString(), 'hledger', 1, otherContent);
      const baseDoc = TextDocument.create(baseUri.toString(), 'hledger', 1, baseContent);

      // Create a mock file reader that returns our test documents
      const fileReader = (uri: URI) => {
        if (uri.toString() === otherUri.toString()) return otherDoc;
        return null;
      };

      // Parse with includes
      const parsed = parser.parse(baseDoc, {
        baseUri: baseUri,
        fileReader: fileReader
      });

      const range = Range.create(0, 0, 100, 0);

      const hints = provider.provideInlayHints(baseDoc, range, parsed, {
        inlayHints: {
          showInferredAmounts: false,
          showRunningBalances: true,
          showCostConversions: false
        }
      } as any);

      // Should have running balance hints for postings in the base file
      // assets:checking at line 4 should show accumulated balance: -50 (from include) + -40 (this transaction) = -90
      const line4Hints = hints.filter(h => h.position.line === 4);
      expect(line4Hints.length).toBeGreaterThan(0);

      const line4Label = labelToString(line4Hints[0].label);
      expect(line4Label).toContain('$-90');
    });
  });
});
