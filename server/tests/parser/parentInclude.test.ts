/**
 * Tests for including files from parent directories
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { parser } from '../../src/parser';
import { defaultFileReader } from '../../src/utils/uri';
import * as path from 'path';
import * as fs from 'fs';

describe('parent directory includes', () => {
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  const childJournalPath = path.join(fixturesPath, 'nested', 'child.journal');

  test('should include file from parent directory using ../path', () => {
    const content = fs.readFileSync(childJournalPath, 'utf8');
    const uri = 'file://' + childJournalPath;
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should have transactions from both child and parent files
    expect(parsed.transactions.length).toBe(2);

    // Should have parent transaction
    const parentTx = parsed.transactions.find(t => t.description === 'Parent Transaction');
    expect(parentTx).toBeDefined();
    expect(parentTx?.sourceUri).toContain('parent.journal');

    // Should have child transaction
    const childTx = parsed.transactions.find(t => t.description === 'Child Transaction');
    expect(childTx).toBeDefined();
    expect(childTx?.sourceUri).toContain('child.journal');

    // Should have accounts from both files
    expect(parsed.accounts.some(a => a.name === 'Assets:Bank')).toBe(true);
    expect(parsed.accounts.some(a => a.name === 'Assets:Cash')).toBe(true);
    expect(parsed.accounts.some(a => a.name === 'Expenses:Utilities')).toBe(true);
  });

  test('should handle multiple levels of parent directory (.../../)', () => {
    // Create a deeper nested structure for testing
    const deepPath = path.join(fixturesPath, 'nested', 'deep');
    if (!fs.existsSync(deepPath)) {
      fs.mkdirSync(deepPath, { recursive: true });
    }

    const deepJournalPath = path.join(deepPath, 'deep.journal');
    fs.writeFileSync(deepJournalPath, `; Deep nested journal
include ../../parent.journal

2024-01-03 * Deep Transaction
    Expenses:Utilities    $25
    Assets:Bank          $-25
`);

    const content = fs.readFileSync(deepJournalPath, 'utf8');
    const uri = 'file://' + deepJournalPath;
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should have transactions from both deep and parent files
    expect(parsed.transactions.length).toBe(2);

    // Should have parent transaction
    const parentTx = parsed.transactions.find(t => t.description === 'Parent Transaction');
    expect(parentTx).toBeDefined();

    // Should have deep transaction
    const deepTx = parsed.transactions.find(t => t.description === 'Deep Transaction');
    expect(deepTx).toBeDefined();

    // Cleanup
    fs.unlinkSync(deepJournalPath);
    fs.rmdirSync(deepPath);
  });

  test('should handle mixed relative paths (../ and ./)', () => {
    // Create a sibling directory
    const siblingPath = path.join(fixturesPath, 'sibling');
    if (!fs.existsSync(siblingPath)) {
      fs.mkdirSync(siblingPath);
    }

    const siblingJournalPath = path.join(siblingPath, 'sibling.journal');
    fs.writeFileSync(siblingJournalPath, `; Sibling journal
2024-01-04 * Sibling Transaction
    Expenses:Utilities    $30
    Assets:Bank          $-30
`);

    // Create a journal in nested that includes both parent and sibling
    const mixedJournalPath = path.join(fixturesPath, 'nested', 'mixed.journal');
    fs.writeFileSync(mixedJournalPath, `; Mixed includes
include ../parent.journal
include ../sibling/sibling.journal

2024-01-05 * Mixed Transaction
    Expenses:Utilities    $40
    Assets:Bank          $-40
`);

    const content = fs.readFileSync(mixedJournalPath, 'utf8');
    const uri = 'file://' + mixedJournalPath;
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should have all three transactions
    expect(parsed.transactions.length).toBe(3);

    expect(parsed.transactions.some(t => t.description === 'Parent Transaction')).toBe(true);
    expect(parsed.transactions.some(t => t.description === 'Sibling Transaction')).toBe(true);
    expect(parsed.transactions.some(t => t.description === 'Mixed Transaction')).toBe(true);

    // Cleanup
    fs.unlinkSync(mixedJournalPath);
    fs.unlinkSync(siblingJournalPath);
    fs.rmdirSync(siblingPath);
  });

  test('should normalize paths and not duplicate includes', () => {
    // Create a journal that includes the same file via different relative paths
    const testPath = path.join(fixturesPath, 'nested', 'normalize-test.journal');
    fs.writeFileSync(testPath, `; Test path normalization
include ../parent.journal
include ./../parent.journal

2024-01-06 * Test Transaction
    Expenses:Utilities    $60
    Assets:Bank          $-60
`);

    const content = fs.readFileSync(testPath, 'utf8');
    const uri = 'file://' + testPath;
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should only include parent.journal ONCE (not duplicated)
    const parentTransactions = parsed.transactions.filter(t => t.description === 'Parent Transaction');
    expect(parentTransactions.length).toBe(1);

    // Should have test transaction too
    expect(parsed.transactions.some(t => t.description === 'Test Transaction')).toBe(true);

    // Total should be 2 (parent + test), not 3 (parent + parent + test)
    expect(parsed.transactions.length).toBe(2);

    // Cleanup
    fs.unlinkSync(testPath);
  });

  test('should correctly resolve path with ../ to check for circular includes', () => {
    // Create a scenario where a file might appear circular due to .. in path
    const circularPath = path.join(fixturesPath, 'nested', 'circular-test.journal');

    // This includes parent, and parent could theoretically include this back
    // but with normalized paths this should be detected
    fs.writeFileSync(circularPath, `; Circular test
include ../parent.journal
`);

    // Temporarily modify parent to include back (create actual circular ref)
    const parentPath = path.join(fixturesPath, 'parent.journal');
    const originalParent = fs.readFileSync(parentPath, 'utf8');
    fs.writeFileSync(parentPath, originalParent + '\ninclude nested/circular-test.journal\n');

    const content = fs.readFileSync(circularPath, 'utf8');
    const uri = 'file://' + circularPath;
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    // Should not hang or fail - circular include should be detected
    // Should have parent transaction
    expect(parsed.transactions.some(t => t.description === 'Parent Transaction')).toBe(true);

    // Restore parent
    fs.writeFileSync(parentPath, originalParent);
    fs.unlinkSync(circularPath);
  });
});
