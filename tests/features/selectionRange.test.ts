import { SelectionRangeProvider } from '../../src/features/selectionRange';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver/node';

describe('SelectionRangeProvider', () => {
  let provider: SelectionRangeProvider;
  let parser: HledgerParser;

  beforeEach(() => {
    provider = new SelectionRangeProvider();
    parser = new HledgerParser();
  });

  describe('provideSelectionRanges', () => {
    test('should return null for empty positions array', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const ranges = provider.provideSelectionRanges(doc, []);

      expect(ranges).toBeNull();
    });

    test('should provide selection range hierarchy for transaction header', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in "Grocery" (character 15)
      const position: Position = { line: 0, character: 15 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);

      // Level 1: Word "Grocery"
      const wordRange = ranges![0];
      expect(wordRange.range.start.line).toBe(0);
      expect(wordRange.range.start.character).toBe(13); // Start of "Grocery"

      // Level 2: Transaction header line
      expect(wordRange.parent).toBeDefined();
      expect(wordRange.parent!.range.start.character).toBe(0);
      expect(wordRange.parent!.range.end.character).toBeGreaterThan(15);

      // Level 3: Entire transaction
      expect(wordRange.parent!.parent).toBeDefined();
      expect(wordRange.parent!.parent!.range.start.line).toBe(0);
      expect(wordRange.parent!.parent!.range.end.line).toBe(2);
    });

    test('should provide selection range hierarchy for posting account', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in "food" (line 1, character 14)
      const position: Position = { line: 1, character: 14 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);

      // Level 1: Word "food"
      const wordRange = ranges![0];
      expect(wordRange.range.start.line).toBe(1);

      // Level 2: Full account name "expenses:food"
      expect(wordRange.parent).toBeDefined();
      const accountRange = wordRange.parent!;
      expect(accountRange.range.start.character).toBeGreaterThan(0); // After indentation

      // Level 3: Entire posting line
      expect(accountRange.parent).toBeDefined();
      expect(accountRange.parent!.range.start.character).toBe(0);

      // Level 4: Entire transaction
      expect(accountRange.parent!.parent).toBeDefined();
      expect(accountRange.parent!.parent!.range.start.line).toBe(0);
      expect(accountRange.parent!.parent!.range.end.line).toBe(2);
    });

    test('should provide selection range for amount in posting', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in amount "$50.00" (line 1, character 21)
      const position: Position = { line: 1, character: 21 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);

      // Should have: word -> posting line -> transaction
      const wordRange = ranges![0];
      expect(wordRange.parent).toBeDefined();
      expect(wordRange.parent!.parent).toBeDefined();
      expect(wordRange.parent!.parent!.range.end.line).toBe(2);
    });

    test('should handle selection in date field', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in date (character 5)
      const position: Position = { line: 0, character: 5 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);

      // Should select date, then header, then transaction
      const dateRange = ranges![0];
      expect(dateRange.range.start.line).toBe(0);
      expect(dateRange.parent).toBeDefined();
      expect(dateRange.parent!.parent).toBeDefined();
    });

    test('should handle multiple positions', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions: Position[] = [
        { line: 0, character: 15 }, // In description
        { line: 1, character: 10 }  // In account
      ];
      const ranges = provider.provideSelectionRanges(doc, positions);

      expect(ranges).toHaveLength(2);
      expect(ranges![0].parent).toBeDefined();
      expect(ranges![1].parent).toBeDefined();
    });

    test('should handle comment lines', () => {
      const content = `; This is a comment
2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in comment
      const position: Position = { line: 0, character: 5 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);
      // Comment should just select the whole line
      expect(ranges![0].range.start.line).toBe(0);
      expect(ranges![0].range.start.character).toBe(0);
    });

    test('should handle directive lines', () => {
      const content = `account assets:checking

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in directive
      const position: Position = { line: 0, character: 10 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);
      // Directive should select the whole line
      expect(ranges![0].range.start.line).toBe(0);
    });

    test('should handle selection in multi-part account name', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food:groceries  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in "groceries" part
      const position: Position = { line: 1, character: 20 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);

      // Should select: word -> full account -> posting -> transaction
      const wordRange = ranges![0];
      expect(wordRange.parent).toBeDefined(); // Full account
      expect(wordRange.parent!.parent).toBeDefined(); // Posting line
      expect(wordRange.parent!.parent!.parent).toBeDefined(); // Transaction
    });

    test('should handle selection when position is at line boundary', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position at start of line
      const position: Position = { line: 1, character: 0 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);
    });

    test('should handle transactions with comments', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00
    ; Transaction note`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position in posting
      const position: Position = { line: 1, character: 10 };
      const ranges = provider.provideSelectionRanges(doc, [position]);

      expect(ranges).toHaveLength(1);
      // Transaction should include the comment line
      expect(ranges![0].parent?.parent?.parent?.range.end.line).toBe(3);
    });
  });
});
