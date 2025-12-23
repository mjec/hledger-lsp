/**
 * Tests for including files using absolute paths
 */

import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { defaultFileReader } from '../../src/utils/uri';
import * as path from 'path';
import * as fs from 'fs';

describe('absolute path includes', () => {
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  const absoluteTestPath = path.join(fixturesPath, 'absolute-test.journal');
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  test('should include file using absolute path', () => {
    const content = `; Main file with absolute include
include ${absoluteTestPath}

account Assets:Checking

2024-01-11 * Main Transaction
    Assets:Checking    $100
    Assets:Bank       $-100
`;

    const uri = URI.file(path.join(fixturesPath, 'main-absolute.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should have transactions from both files
    expect(parsed.transactions.length).toBe(2);

    // Should have the absolute test transaction
    const absoluteTx = parsed.transactions.find(t => t.description === 'Absolute Path Test');
    expect(absoluteTx).toBeDefined();
    expect(absoluteTx?.sourceUri?.toString()).toContain('absolute-test.journal');

    // Should have the main transaction
    const mainTx = parsed.transactions.find(t => t.description === 'Main Transaction');
    expect(mainTx).toBeDefined();

    // Should have accounts from both files
    expect(Array.from(parsed.accounts.values()).some(a => a.name === 'Assets:Bank')).toBe(true);
    expect(Array.from(parsed.accounts.values()).some(a => a.name === 'Assets:Checking')).toBe(true);
    expect(Array.from(parsed.accounts.values()).some(a => a.name === 'Expenses:Test')).toBe(true);
  });

  test('should handle absolute path with file:// URI', () => {
    const fileUri = URI.file(absoluteTestPath);
    const content = `; Main file with absolute file:// URI
include ${fileUri.toString()}

2024-01-12 * URI Test Transaction
    Assets:Bank    $50
    Expenses:Test $-50
`;

    const uri = URI.file(path.join(fixturesPath, 'main-uri.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should have transactions from both files
    expect(parsed.transactions.length).toBe(2);

    const absoluteTx = parsed.transactions.find(t => t.description === 'Absolute Path Test');
    expect(absoluteTx).toBeDefined();

    const uriTx = parsed.transactions.find(t => t.description === 'URI Test Transaction');
    expect(uriTx).toBeDefined();
  });

  test('should handle absolute path on Linux', () => {
    // This test is Linux-specific
    const content = `; Linux absolute path test
include ${absoluteTestPath}

2024-01-13 * Linux Test
    Assets:Bank    $25
    Expenses:Test $-25
`;

    const uri = URI.file(path.join(fixturesPath, 'linux-test.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    expect(parsed.transactions.length).toBe(2);
    expect(parsed.transactions.some(t => t.description === 'Absolute Path Test')).toBe(true);
    expect(parsed.transactions.some(t => t.description === 'Linux Test')).toBe(true);
  });

  test('should handle tilde expansion for home directory', () => {
    // Create a test file in a temp location
    const homeDir = require('os').homedir();
    const testFile = path.join(homeDir, '.hledger-test-temp.journal');

    fs.writeFileSync(testFile, `; Temp test file
account Assets:Temp

2024-01-14 * Temp Transaction
    Assets:Temp    $10
    Assets:Bank   $-10
`);

    const content = `; Test tilde expansion
include ~/.hledger-test-temp.journal

2024-01-15 * Main Transaction
    Assets:Bank    $20
    Assets:Temp   $-20
`;

    const uri = URI.file(path.join(fixturesPath, 'tilde-test.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    expect(parsed.transactions.length).toBe(2);
    expect(parsed.transactions.some(t => t.description === 'Temp Transaction')).toBe(true);
    expect(parsed.transactions.some(t => t.description === 'Main Transaction')).toBe(true);

    // Cleanup
    fs.unlinkSync(testFile);
  });

  test('should not include non-existent absolute path', () => {
    const nonExistentPath = '/tmp/does-not-exist-hledger.journal';
    const content = `; Test non-existent file
include ${nonExistentPath}

2024-01-16 * Only Transaction
    Assets:Bank    $30
    Expenses:Test $-30
`;

    const uri = URI.file(path.join(fixturesPath, 'nonexistent-test.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should only have the main transaction (include fails silently)
    expect(parsed.transactions.length).toBe(1);
    expect(parsed.transactions[0].description).toBe('Only Transaction');
  });
});
