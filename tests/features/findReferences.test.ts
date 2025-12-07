import { findReferencesProvider } from '../../src/features/findReferences';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { parser } from '../../src/parser';

describe('FindReferencesProvider', () => {
  describe('findReferences', () => {
    describe('account references', () => {
      test('should find all account references', () => {
        const content = `account Assets:Checking

2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Gas Station
    Expenses:Transport            $30
    Assets:Checking               $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "Assets:Checking" in the account directive
        const position = Position.create(0, 10);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(3); // 1 declaration + 2 usages

        // Check all references point to Assets:Checking
        expect(references![0].range.start.line).toBe(0); // Declaration
        expect(references![1].range.start.line).toBe(4); // First usage
        expect(references![2].range.start.line).toBe(8); // Second usage
      });

      test('should find account references from posting', () => {
        const content = `2024-01-15 * Test
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Test 2
    Expenses:Food                 $30
    Assets:Checking               $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "Assets:Checking" in first transaction
        const position = Position.create(2, 6);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(2);
        expect(references![0].range.start.line).toBe(2);
        expect(references![1].range.start.line).toBe(6);
      });

      test('should return null when not on any symbol', () => {
        const content = `2024-01-15 * Test
    Expenses:Food                 $50`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on whitespace
        const position = Position.create(1, 25);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).toBeNull();
      });
    });

    describe('payee references', () => {
      test('should find all payee references', () => {
        const content = `payee Grocery Store

2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Grocery Store
    Expenses:Food                 $30
    Assets:Checking               $-30

2024-01-17 * Gas Station
    Expenses:Transport            $20
    Assets:Checking               $-20`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "Grocery Store" in the payee directive
        const position = Position.create(0, 10);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(3); // 1 declaration + 2 usages

        expect(references![0].range.start.line).toBe(0); // Declaration
        expect(references![1].range.start.line).toBe(2); // First usage
        expect(references![2].range.start.line).toBe(6); // Second usage
      });

      test('should find payee references from transaction', () => {
        const content = `2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Grocery Store
    Expenses:Food                 $30
    Assets:Checking               $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "Grocery Store" in first transaction
        const position = Position.create(0, 17);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(2);
        expect(references![0].range.start.line).toBe(0);
        expect(references![1].range.start.line).toBe(4);
      });
    });

    describe('commodity references', () => {
      test('should find commodity references including directive', () => {
        const content = `commodity $

2024-01-15 * Test
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Test 2
    Expenses:Transport            €30
    Assets:EUR                    €-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "$" in the commodity directive
        const position = Position.create(0, 10);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references!.length).toBeGreaterThanOrEqual(1); // At least the declaration
      });

      test('should detect commodity at cursor in posting', () => {
        const content = `2024-01-15 * Test
    Expenses:Food                 $50
    Assets:Checking               $-50`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "$" in first posting
        const position = Position.create(1, 34);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        // Should at least detect that we're on a commodity and return a result
        expect(references).not.toBeNull();
      });
    });

    describe('tag references', () => {
      test('should find all tag references', () => {
        const content = `tag project

2024-01-15 * Test  ; project:home
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Test 2  ; project:work
    Expenses:Food                 $30
    Assets:Checking               $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "project" in the tag directive
        const position = Position.create(0, 6);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(3); // 1 declaration + 2 usages

        expect(references![0].range.start.line).toBe(0); // Declaration
        expect(references![1].range.start.line).toBe(2); // First usage
        expect(references![2].range.start.line).toBe(6); // Second usage
      });

      test('should find tag references from comment', () => {
        const content = `2024-01-15 * Test  ; project:home
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Test 2  ; project:work
    Expenses:Food                 $30
    Assets:Checking               $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "project" in first comment
        const position = Position.create(0, 21);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(2);
        expect(references![0].range.start.line).toBe(0);
        expect(references![1].range.start.line).toBe(4);
      });

      test('should find tag references in posting comments', () => {
        const content = `2024-01-15 * Test
    Expenses:Food                 $50  ; project:home
    Assets:Checking               $-50  ; project:home`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        // Click on "project" in posting comment
        const position = Position.create(1, 42);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(2);
      });
    });

    describe('edge cases', () => {
      test('should handle empty document', () => {
        const content = '';
        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        const position = Position.create(0, 0);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).toBeNull();
      });

      test('should handle accounts with colons', () => {
        const content = `2024-01-15 * Test
    Assets:Bank:Checking          $50
    Expenses:Food                 $-50

2024-01-16 * Test 2
    Assets:Bank:Checking          $30
    Expenses:Food                 $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        const position = Position.create(1, 10);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(2);
      });

      test('should handle accounts with spaces', () => {
        const content = `2024-01-15 * Test
    Assets:Checking Account       $50
    Expenses:Food                 $-50

2024-01-16 * Test 2
    Assets:Checking Account       $30
    Expenses:Food                 $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        const position = Position.create(1, 10);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(2);
      });

      test('should handle payees with special characters', () => {
        const content = `2024-01-15 * McDonald's Restaurant
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * McDonald's Restaurant
    Expenses:Food                 $30
    Assets:Checking               $-30`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        const position = Position.create(0, 17);
        const references = findReferencesProvider.findReferences(doc, position, parsed, true);

        expect(references).not.toBeNull();
        expect(references).toHaveLength(2);
      });
    });
  });
});
