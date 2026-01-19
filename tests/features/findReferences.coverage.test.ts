/**
 * Additional tests for findReferences.ts to improve coverage
 * Targets uncovered lines: 115-121, 174-176, 248, 310-315, 385-390, 458-463, 511-515, 527-531, 567-572
 */
import { findReferencesProvider, FindReferencesProvider } from '../../src/features/findReferences';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../src/parser';
import { ParsedDocument } from '../../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FindReferencesProvider - Coverage Tests', () => {
  let parser: HledgerParser;
  let tmpDir: string;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('getItemAtCursor edge cases', () => {
    test('should return null when cursor is before directive value', () => {
      // Test line 162 condition: char < line.indexOf(directive.value)
      const content = `account Assets:Checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Click before "Assets" (on "account")
      const position = Position.create(0, 2);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).toBeNull();
    });

    test('should return null when cursor is before commodity directive value', () => {
      // Test lines 174-176: returns null when char < line.indexOf(commodityMatch[1])
      const content = `commodity USD 1,000.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Click before "USD" (on "commodity")
      const position = Position.create(0, 3);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).toBeNull();
    });

    test('should detect commodity via fallback regex for currency symbols', () => {
      // Test line 248: fallback commodityFallbackRegex
      const content = `2024-01-15 * Test
    Expenses:Food                 £50
    Assets:Bank                   £-50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Click on "£" symbol
      const position = Position.create(1, 34);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('commodity');
      expect(item?.name).toBe('£');
    });

    test('should detect EUR commodity via fallback regex', () => {
      const content = `2024-01-15 * Test
    Expenses:Food                 50 EUR
    Assets:Bank                   -50 EUR`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Click on "EUR"
      const position = Position.create(1, 37);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('commodity');
      expect(item?.name).toBe('EUR');
    });

    test('should handle tag on standalone comment line', () => {
      // Test lines 271-283: fallback tag matching for non-directive/non-transaction lines
      const content = `; project:home
2024-01-15 * Test
    Expenses:Food                 $50`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Click on "project" in standalone comment
      const position = Position.create(0, 2);
      const item = findReferencesProvider.getItemAtCursor(doc, position, parsed);

      expect(item).not.toBeNull();
      expect(item?.type).toBe('tag');
      expect(item?.name).toBe('project');
    });
  });

  describe('findCommodityReferences with assertions and costs', () => {
    test('should find commodity in balance assertion', () => {
      // Test lines 511-515: assertion commodity refs
      const content = `2024-01-15 * Test
    Assets:Checking               $100 = $200
    Income:Salary                 $-100`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const uri = URI.parse(doc.uri);

      const fileReader = (u: URI) => doc;
      const ranges = findReferencesProvider.findCommodityReferences(parsed, '$', uri, fileReader);

      // Should find $ in both amount and assertion
      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });

    test('should find commodity in cost annotation', () => {
      // Test lines 527-531: cost commodity refs
      const content = `2024-01-15 * Buy stock
    Assets:Investments            10 AAPL @ $150
    Assets:Checking               $-1500`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const uri = URI.parse(doc.uri);

      const fileReader = (u: URI) => doc;
      const ranges = findReferencesProvider.findCommodityReferences(parsed, '$', uri, fileReader);

      // Should find $ in cost annotation and in checking posting
      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('findAccountReferences disk fallback', () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-findref-'));
    });

    afterEach(() => {
      // Cleanup
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    });

    test('should read file from disk when fileReader returns null', () => {
      // Test lines 310-315: fallback file reading
      const content = `account Assets:Checking

2024-01-15 * Test
    Assets:Checking               $100
    Income:Salary                 $-100`;

      const filePath = path.join(tmpDir, 'test.journal');
      fs.writeFileSync(filePath, content, 'utf-8');

      const uri = URI.file(filePath);
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // fileReader returns null, should fallback to reading from disk
      const fileReader = () => null;
      const ranges = findReferencesProvider.findAccountReferences(parsed, 'Assets:Checking', uri, fileReader);

      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });

    test('should return empty when file cannot be read', () => {
      // Test lines 314-315: error reading file
      const parsed: ParsedDocument = {
        transactions: [],
        accounts: new Map(),
        directives: [{
          type: 'account',
          value: 'Assets:Checking',
          line: 0,
          sourceUri: URI.file('/nonexistent/file.journal')
        }],
        commodities: new Map(),
        payees: new Map(),
        tags: new Map()
      };

      const uri = URI.file('/nonexistent/file.journal');
      const ranges = findReferencesProvider.findAccountReferences(parsed, 'Assets:Checking', uri, undefined);

      expect(ranges).toEqual([]);
    });
  });

  describe('findPayeeReferences disk fallback', () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-findref-'));
    });

    afterEach(() => {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    });

    test('should read file from disk when fileReader returns null for payees', () => {
      // Test lines 385-390: fallback file reading for payees
      const content = `payee Grocery Store

2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50`;

      const filePath = path.join(tmpDir, 'test.journal');
      fs.writeFileSync(filePath, content, 'utf-8');

      const uri = URI.file(filePath);
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const fileReader = () => null;
      const ranges = findReferencesProvider.findPayeeReferences(parsed, 'Grocery Store', uri, fileReader);

      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });

    test('should return empty when file cannot be read for payees', () => {
      const parsed: ParsedDocument = {
        transactions: [],
        accounts: new Map(),
        directives: [{
          type: 'payee',
          value: 'Grocery Store',
          line: 0,
          sourceUri: URI.file('/nonexistent/file.journal')
        }],
        commodities: new Map(),
        payees: new Map(),
        tags: new Map()
      };

      const uri = URI.file('/nonexistent/file.journal');
      const ranges = findReferencesProvider.findPayeeReferences(parsed, 'Grocery Store', uri, undefined);

      expect(ranges).toEqual([]);
    });
  });

  describe('findCommodityReferences disk fallback', () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-findref-'));
    });

    afterEach(() => {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    });

    test('should read file from disk when fileReader returns null for commodities', () => {
      // Test lines 458-463: fallback file reading for commodities
      const content = `commodity $

2024-01-15 * Test
    Expenses:Food                 $50
    Assets:Checking               $-50`;

      const filePath = path.join(tmpDir, 'test.journal');
      fs.writeFileSync(filePath, content, 'utf-8');

      const uri = URI.file(filePath);
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const fileReader = () => null;
      const ranges = findReferencesProvider.findCommodityReferences(parsed, '$', uri, fileReader);

      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });

    test('should return empty when file cannot be read for commodities', () => {
      const parsed: ParsedDocument = {
        transactions: [],
        accounts: new Map(),
        directives: [{
          type: 'commodity',
          value: '$',
          line: 0,
          sourceUri: URI.file('/nonexistent/file.journal')
        }],
        commodities: new Map(),
        payees: new Map(),
        tags: new Map()
      };

      const uri = URI.file('/nonexistent/file.journal');
      const ranges = findReferencesProvider.findCommodityReferences(parsed, '$', uri, undefined);

      expect(ranges).toEqual([]);
    });
  });

  describe('findTagReferences disk fallback', () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-findref-'));
    });

    afterEach(() => {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    });

    test('should read file from disk when fileReader returns null for tags', () => {
      // Test lines 567-572: fallback file reading for tags
      const content = `tag project

2024-01-15 * Test  ; project:home
    Expenses:Food                 $50
    Assets:Checking               $-50`;

      const filePath = path.join(tmpDir, 'test.journal');
      fs.writeFileSync(filePath, content, 'utf-8');

      const uri = URI.file(filePath);
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const fileReader = () => null;
      const ranges = findReferencesProvider.findTagReferences(parsed, 'project', uri, fileReader);

      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });

    test('should return empty when file cannot be read for tags', () => {
      const parsed: ParsedDocument = {
        transactions: [],
        accounts: new Map(),
        directives: [{
          type: 'tag',
          value: 'project',
          line: 0,
          sourceUri: URI.file('/nonexistent/file.journal')
        }],
        commodities: new Map(),
        payees: new Map(),
        tags: new Map()
      };

      const uri = URI.file('/nonexistent/file.journal');
      const ranges = findReferencesProvider.findTagReferences(parsed, 'project', uri, undefined);

      expect(ranges).toEqual([]);
    });
  });
});
