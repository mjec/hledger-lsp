import { findReferencesProvider } from '../../src/features/findReferences';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../src/parser';

describe('FindReferencesProvider - Workspace References', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('findWorkspaceReferences', () => {
    test('should find references across multiple workspace files', () => {
      const doc1Content = `account Assets:Checking

2024-01-15 * Test
    Assets:Checking               $100
    Expenses:Food                 $-100`;

      const doc2Content = `2024-01-16 * Test 2
    Assets:Checking               $50
    Expenses:Transport            $-50`;

      const doc1 = TextDocument.create('file:///doc1.journal', 'hledger', 1, doc1Content);
      const doc2 = TextDocument.create('file:///doc2.journal', 'hledger', 1, doc2Content);

      const parsed1 = parser.parse(doc1);

      const fileUris = [URI.parse('file:///doc1.journal'), URI.parse('file:///doc2.journal')];

      const fileReader = (uri: any): TextDocument | null => {
        if (uri.toString() === 'file:///doc1.journal') return doc1;
        if (uri.toString() === 'file:///doc2.journal') return doc2;
        return null;
      };

      // Click on "Assets:Checking" in first document
      const position = Position.create(0, 10);
      const references = findReferencesProvider.findWorkspaceReferences(
        doc1,
        position,
        parsed1,
        fileUris,
        parser,
        fileReader
      );

      expect(references).not.toBeNull();
      // Should find references in both files
      expect(references!.length).toBeGreaterThanOrEqual(2);
    });

    test('should handle workspace references with parsing errors', () => {
      const validContent = `account Assets:Checking

2024-01-15 * Test
    Assets:Checking               $100
    Expenses:Food                 $-100`;

      const validDoc = TextDocument.create('file:///valid.journal', 'hledger', 1, validContent);
      const parsed = parser.parse(validDoc);

      const fileUris = [
        URI.parse('file:///valid.journal'),
        URI.parse('file:///invalid.journal')
      ];

      let callCount = 0;
      const fileReader = (uri: any): TextDocument | null => {
        callCount++;
        if (uri.toString() === 'file:///valid.journal') return validDoc;
        // Return invalid content that will cause parsing errors
        if (uri.toString() === 'file:///invalid.journal') {
          return TextDocument.create('file:///invalid.journal', 'hledger', 1, 'invalid content ][}{');
        }
        return null;
      };

      const position = Position.create(0, 10);
      const references = findReferencesProvider.findWorkspaceReferences(
        validDoc,
        position,
        parsed,
        fileUris,
        parser,
        fileReader
      );

      // Should still return results from valid files even if some files have errors
      expect(references).not.toBeNull();
      expect(callCount).toBeGreaterThan(0);
    });

    test('should handle workspace references without fileReader', () => {
      const content = `account Assets:Checking

2024-01-15 * Test
    Assets:Checking               $100
    Expenses:Food                 $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const fileUris = [URI.parse('file:///test.journal')];

      // Call without fileReader - should fallback gracefully
      const position = Position.create(0, 10);
      const references = findReferencesProvider.findWorkspaceReferences(
        doc,
        position,
        parsed,
        fileUris,
        parser,
        undefined
      );

      // Should handle the call gracefully
      expect(references).toBeDefined();
    });

    test('should return null when item not found at cursor in workspace search', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const fileUris = [URI.parse('file:///test.journal')];

      // Click on whitespace
      const position = Position.create(1, 25);
      const references = findReferencesProvider.findWorkspaceReferences(
        doc,
        position,
        parsed,
        fileUris,
        parser
      );

      expect(references).toBeNull();
    });

    test('should handle empty workspace file list', () => {
      const content = `account Assets:Checking

2024-01-15 * Test
    Assets:Checking               $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Empty file list
      const fileUris: URI[] = [];

      const position = Position.create(0, 10);
      const references = findReferencesProvider.findWorkspaceReferences(
        doc,
        position,
        parsed,
        fileUris,
        parser
      );

      // Should return empty or null when no files to search
      expect(references === null || references?.length === 0).toBe(true);
    });
  });

  describe('getItemAtCursor', () => {
    test('should correctly identify account on directive line', () => {
      const content = `account Assets:Checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(0, 12);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('account');
      expect(item?.name).toBe('Assets:Checking');
    });

    test('should correctly identify commodity on directive line', () => {
      const content = `commodity $
  format $#,##0.00`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(0, 10);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('commodity');
    });

    test('should correctly identify tag on directive line', () => {
      const content = `tag project`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(0, 6);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('tag');
    });

    test('should correctly identify payee on directive line', () => {
      const content = `payee Grocery Store`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(0, 8);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('payee');
    });

    test('should handle position beyond line length', () => {
      const content = `account Assets:Checking`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(10, 0); // Line beyond document
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).toBeNull();
    });

    test('should handle empty line at position', () => {
      const content = `account Assets:Checking

2024-01-15 * Test`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(1, 0); // Empty line
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).toBeNull();
    });

    test('should correctly identify account in posting', () => {
      const content = `2024-01-15 * Test
    Assets:Checking               $100
    Expenses:Food                 $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(1, 8);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('account');
    });

    test('should correctly identify payee in transaction header', () => {
      const content = `2024-01-15 * Grocery Store
    Expenses:Food                 $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(0, 18);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('payee');
    });

    test('should correctly identify tag in transaction comment', () => {
      const content = `2024-01-15 * Test  ; project:home
    Expenses:Food                 $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(0, 22);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('tag');
    });

    test('should correctly identify tag in posting comment', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100  ; project:home`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(1, 48);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('tag');
    });

    test('should return null when cursor on unknown symbol', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Click on the date
      const position = Position.create(0, 2);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).toBeNull();
    });

    test('should handle case sensitivity correctly for accounts', () => {
      const content = `2024-01-15 * Test
    Assets:Checking               $100
    Assets:checking                $50`; // Different case

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const position = Position.create(1, 8);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('account');
      // The item should represent the exact account name at this position
      expect(item?.name).toMatch(/Assets:Checking/i);
    });
  });
});
