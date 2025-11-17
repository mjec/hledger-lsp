import { FoldingRangesProvider } from '../../src/features/foldingRanges';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FoldingRangeKind } from 'vscode-languageserver/node';

describe('FoldingRangesProvider', () => {
  let provider: FoldingRangesProvider;
  let parser: HledgerParser;

  beforeEach(() => {
    provider = new FoldingRangesProvider();
    parser = new HledgerParser();
  });

  describe('provideFoldingRanges', () => {
    test('should return empty array for empty document', () => {
      const content = '';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      expect(ranges).toEqual([]);
    });

    test('should provide folding range for transaction with multiple postings', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      expect(ranges).toHaveLength(1);
      expect(ranges[0].startLine).toBe(0);
      expect(ranges[0].endLine).toBe(2);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Region);
    });

    test('should not provide folding range for transaction with only one posting', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      // Should have folding range since there's at least one posting after header
      expect(ranges).toHaveLength(1);
      expect(ranges[0].startLine).toBe(0);
      expect(ranges[0].endLine).toBe(1);
    });

    test('should provide folding ranges for multiple transactions', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-16 * Gas Station
    expenses:transportation  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      expect(ranges).toHaveLength(2);
      expect(ranges[0].startLine).toBe(0);
      expect(ranges[0].endLine).toBe(2);
      expect(ranges[1].startLine).toBe(4);
      expect(ranges[1].endLine).toBe(6);
    });

    test('should include transaction-level comments in folding range', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00
    ; Transaction note
    ; Another note`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      // Should have one range for the transaction (including comments)
      // and one range for the multi-line comment block
      expect(ranges.length).toBeGreaterThanOrEqual(1);

      // Find the transaction range
      const transactionRanges = ranges.filter(r => r.kind === FoldingRangeKind.Region);
      expect(transactionRanges).toHaveLength(1);
      expect(transactionRanges[0].startLine).toBe(0);
      expect(transactionRanges[0].endLine).toBe(4); // Includes both comment lines
    });

    test('should provide folding range for multi-line comment block', () => {
      const content = `; This is a comment
; Another comment
; Third comment

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      // Should have one for the comment block and one for the transaction
      expect(ranges.length).toBeGreaterThanOrEqual(1);

      const commentRanges = ranges.filter(r => r.kind === FoldingRangeKind.Comment);
      expect(commentRanges).toHaveLength(1);
      expect(commentRanges[0].startLine).toBe(0);
      expect(commentRanges[0].endLine).toBe(2);
    });

    test('should not fold single-line comments', () => {
      const content = `; Single comment

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      const commentRanges = ranges.filter(r => r.kind === FoldingRangeKind.Comment);
      expect(commentRanges).toHaveLength(0);
    });

    test('should handle mixed directives, comments, and transactions', () => {
      const content = `; File header comment
; Second line of header

account assets:checking
account expenses:food

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00

; Middle comment
; Second line

2024-01-16 * Gas Station
    expenses:transportation  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      // Should have ranges for: header comment block, middle comment block, and 2 transactions
      expect(ranges.length).toBeGreaterThanOrEqual(4);
    });

    test('should handle transactions without blank line separators', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00
2024-01-16 * Gas Station
    expenses:transportation  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const ranges = provider.provideFoldingRanges(doc, parsedDoc);

      expect(ranges).toHaveLength(2);
      expect(ranges[0].startLine).toBe(0);
      expect(ranges[0].endLine).toBe(2);
      expect(ranges[1].startLine).toBe(3);
      expect(ranges[1].endLine).toBe(5);
    });
  });
});
