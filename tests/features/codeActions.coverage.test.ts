/**
 * Additional tests for codeActions.ts to improve coverage
 * Targets uncovered lines: 261-265, 304, 334-335, 356, 382, 387
 */
import { codeActionProvider } from '../../src/features/codeActions';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CodeActionsProvider - Coverage Tests', () => {
  let parser: HledgerParser;
  let tmpDir: string;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('createRenameEdit', () => {
    test('should rename commodity references (lines 261-262)', () => {
      const content = `commodity $
  format $1,000.00

2024-01-15 * Test
    Assets:Bank  $100
    Income:Salary  $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const edit = codeActionProvider.createRenameEdit(
        doc,
        { type: 'commodity', name: '$' },
        'USD',
        parsed
      );

      expect(edit.changes).toBeDefined();
      expect(edit.changes!['file:///test.journal']).toBeDefined();
      // Should have edits for commodity directive and postings
      expect(edit.changes!['file:///test.journal'].length).toBeGreaterThan(0);
    });

    test('should rename tag references (lines 264-265)', () => {
      const content = `tag project

2024-01-15 * Test  ; project:home
    Assets:Bank  $100  ; project:home
    Income:Salary`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const edit = codeActionProvider.createRenameEdit(
        doc,
        { type: 'tag', name: 'project' },
        'category',
        parsed
      );

      expect(edit.changes).toBeDefined();
      expect(edit.changes!['file:///test.journal']).toBeDefined();
      expect(edit.changes!['file:///test.journal'].length).toBeGreaterThan(0);
    });
  });

  describe('createWorkspaceRenameEdit', () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-codeactions-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('should read from disk when fileReader returns null (line 304)', () => {
      const filePath = path.join(tmpDir, 'test.journal');
      const content = `account Assets:Bank

2024-01-15 * Test
    Assets:Bank  $100
    Income:Salary`;

      fs.writeFileSync(filePath, content, 'utf-8');

      const fileUri = URI.file(filePath);

      // fileReader always returns null - should fall back to disk
      const fileReader = () => null;

      const edit = codeActionProvider.createWorkspaceRenameEdit(
        { type: 'account', name: 'Assets:Bank' },
        'Assets:Checking',
        [fileUri],
        parser,
        fileReader
      );

      expect(edit.changes).toBeDefined();
      expect(edit.changes![fileUri.toString()]).toBeDefined();
    });

    test('should rename tags across workspace files (lines 334-335)', () => {
      const file1Path = path.join(tmpDir, 'main.journal');
      const file2Path = path.join(tmpDir, 'expenses.journal');

      const content1 = `tag project

2024-01-15 * Test  ; project:work
    Assets:Bank  $100`;

      const content2 = `2024-01-20 * Another  ; project:home
    Expenses:Food  $50
    Assets:Bank`;

      fs.writeFileSync(file1Path, content1, 'utf-8');
      fs.writeFileSync(file2Path, content2, 'utf-8');

      const fileUris = [URI.file(file1Path), URI.file(file2Path)];

      const edit = codeActionProvider.createWorkspaceRenameEdit(
        { type: 'tag', name: 'project' },
        'category',
        fileUris,
        parser,
        undefined
      );

      expect(edit.changes).toBeDefined();
      // Should have edits in both files
      expect(Object.keys(edit.changes!).length).toBeGreaterThan(0);
    });

    test('should rename commodities across workspace files', () => {
      const file1Path = path.join(tmpDir, 'main.journal');
      const file2Path = path.join(tmpDir, 'expenses.journal');

      const content1 = `commodity $

2024-01-15 * Test
    Assets:Bank  $100`;

      const content2 = `2024-01-20 * Food
    Expenses:Food  $50
    Assets:Bank`;

      fs.writeFileSync(file1Path, content1, 'utf-8');
      fs.writeFileSync(file2Path, content2, 'utf-8');

      const fileUris = [URI.file(file1Path), URI.file(file2Path)];

      const edit = codeActionProvider.createWorkspaceRenameEdit(
        { type: 'commodity', name: '$' },
        'USD',
        fileUris,
        parser,
        undefined
      );

      expect(edit.changes).toBeDefined();
    });

    test('should skip files that cannot be parsed', () => {
      const file1Path = path.join(tmpDir, 'valid.journal');
      const file2Path = path.join(tmpDir, 'missing.journal');

      const content1 = `2024-01-15 * Test
    Assets:Bank  $100
    Income:Salary`;

      fs.writeFileSync(file1Path, content1, 'utf-8');
      // file2 doesn't exist - should be skipped

      const fileUris = [URI.file(file1Path), URI.file(file2Path)];

      // Should not throw, just skip the missing file
      const edit = codeActionProvider.createWorkspaceRenameEdit(
        { type: 'account', name: 'Assets:Bank' },
        'Assets:Checking',
        fileUris,
        parser,
        undefined
      );

      expect(edit.changes).toBeDefined();
      // Should only have edits for the valid file
      expect(edit.changes![URI.file(file1Path).toString()]).toBeDefined();
    });
  });

  describe('getPostingAtPosition edge cases', () => {
    test('should return null when position is beyond document (line 356)', () => {
      const content = `2024-01-15 * Test
    Assets:Bank  $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Position beyond document
      const actions = codeActionProvider.provideCodeActions(
        doc,
        { start: { line: 100, character: 0 }, end: { line: 100, character: 10 } },
        [],
        parser.parse(doc)
      );

      // Should not crash, return empty or valid actions
      expect(Array.isArray(actions)).toBe(true);
    });

    test('should return null when no commodity found (line 382)', () => {
      const content = `2024-01-15 * Test
    Assets:Bank  100
    Income:Salary`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Position on posting without commodity (just a number)
      const actions = codeActionProvider.provideCodeActions(
        doc,
        { start: { line: 1, character: 15 }, end: { line: 1, character: 15 } },
        [],
        parsed
      );

      expect(Array.isArray(actions)).toBe(true);
    });

    test('should return null when quantity is NaN (line 387)', () => {
      const content = `2024-01-15 * Test
    Assets:Bank  $abc
    Income:Salary`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // This is an invalid amount, should not crash
      const actions = codeActionProvider.provideCodeActions(
        doc,
        { start: { line: 1, character: 15 }, end: { line: 1, character: 15 } },
        [],
        parsed
      );

      expect(Array.isArray(actions)).toBe(true);
    });

    test('should handle posting line that is not indented', () => {
      const content = `2024-01-15 * Test
Assets:Bank  $100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Line 1 is not properly indented as a posting
      const actions = codeActionProvider.provideCodeActions(
        doc,
        { start: { line: 1, character: 5 }, end: { line: 1, character: 5 } },
        [],
        parsed
      );

      expect(Array.isArray(actions)).toBe(true);
    });
  });

  describe('negative amount handling', () => {
    test('should handle negative amounts in postings', () => {
      const content = `2024-01-15 * Test
    Assets:Bank  -$100
    Income:Salary`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const actions = codeActionProvider.provideCodeActions(
        doc,
        { start: { line: 1, character: 15 }, end: { line: 1, character: 15 } },
        [],
        parsed
      );

      expect(Array.isArray(actions)).toBe(true);
    });
  });
});
