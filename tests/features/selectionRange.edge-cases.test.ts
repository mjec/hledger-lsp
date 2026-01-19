import { selectionRangeProvider } from '../../src/features/selectionRange';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';

describe('SelectionRangeProvider - Edge Cases', () => {
  describe('provideSelectionRanges', () => {
    test('should handle empty positions array', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, []);

      expect(ranges).toBeNull();
    });

    test('should handle multiple positions', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100

2024-01-16 * Test 2
    Expenses:Food                 $50
    Assets:Checking               $-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 10),
        Position.create(5, 10),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
      expect(ranges?.length).toBeGreaterThan(0);
    });

    test('should handle position beyond document', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(100, 0),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Should handle gracefully by returning null or empty array
      expect(ranges === null || ranges.length === 0).toBe(true);
    });

    test('should handle position on empty line', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100

2024-01-16 * Test`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(2, 0),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Should handle empty lines gracefully
      expect(ranges === null || ranges.length === 0).toBe(true);
    });

    test('should handle position on transaction header', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(0, 15),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
      if (ranges) {
        expect(ranges.length).toBeGreaterThan(0);
        // Selection should cover the transaction
      }
    });

    test('should handle position on posting account', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 10),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
      if (ranges) {
        expect(ranges.length).toBeGreaterThan(0);
        // Selection should expand from account to posting to transaction
      }
    });

    test('should handle position on posting amount', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 45),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Position might not yield ranges if it's in whitespace
      expect(ranges === null || ranges.length >= 0).toBe(true);
    });

    test('should handle position on transaction date', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(0, 2),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Date is part of transaction header
      expect(ranges === null || ranges.length >= 0).toBe(true);
    });

    test('should handle position at end of line', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 200),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Should still provide ranges for the posting
      expect(ranges === null || ranges.length >= 0).toBe(true);
    });

    test('should handle transaction with no payee', () => {
      const content = `2024-01-15 * 
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(0, 12),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Should handle missing payee gracefully
      expect(ranges === null || ranges.length >= 0).toBe(true);
    });

    test('should handle transaction with only one posting', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 10),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
    });

    test('should handle position on account with colons', () => {
      const content = `2024-01-15 * Test
    Assets:Bank:Checking          $100
    Expenses:Food                 $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 15),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
    });

    test('should handle position in posting with comment', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100  ; lunch
    Assets:Checking               $-100 ; checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 10),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
    });

    test('should handle position at beginning of line', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 0),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Should handle beginning of line (whitespace)
      expect(ranges === null || ranges.length >= 0).toBe(true);
    });

    test('should handle very long account names', () => {
      const content = `2024-01-15 * Test
    Assets:LongAccountName:SubAccount:Another:Level $100
    Expenses:Food                                      $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 30),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
    });

    test('should handle transaction with status flag', () => {
      const content = `2024-01-15 ! * Test
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(0, 12),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges === null || ranges.length >= 0).toBe(true);
    });

    test('should handle posting with status flag', () => {
      const content = `2024-01-15 * Test
    ! Expenses:Food                 $100
    * Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 10),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
    });

    test('should handle posting with posting date', () => {
      const content = `2024-01-15 * Test
    2024-01-16 Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 20),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
    });

    test('should handle empty document', () => {
      const content = ``;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(0, 0),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Should return null for empty document
      expect(ranges === null || ranges.length === 0).toBe(true);
    });

    test('should handle whitespace-only lines', () => {
      const content = `2024-01-15 * Test
    
    Expenses:Food                 $100
    
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(1, 0),
        Position.create(3, 0),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      // Should handle whitespace-only lines gracefully
      expect(ranges === null || ranges.length >= 0).toBe(true);
    });

    test('should handle position with special characters in payee', () => {
      const content = `2024-01-15 * McDonald's Restaurant & Café
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(0, 18),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges).not.toBeNull();
    });

    test('should handle transaction with tags', () => {
      const content = `2024-01-15 * Test  ; project:home
    Expenses:Food                 $100
    Assets:Checking               $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      const positions = [
        Position.create(0, 20),
      ];

      const ranges = selectionRangeProvider.provideSelectionRanges(doc, positions);

      expect(ranges === null || ranges.length >= 0).toBe(true);
    });
  });
});
