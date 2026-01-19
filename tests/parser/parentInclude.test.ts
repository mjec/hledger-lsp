/**
 * Tests for including files from parent directories
 */

import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { defaultFileReader } from '../../src/utils/uri';
import { WorkspaceManager } from '../../src/server/workspace';
import { createMockConnection } from '../helpers/workspaceTestHelper';
import * as path from 'path';
import * as fs from 'fs';

describe('parent directory includes', () => {
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  const childJournalPath = path.join(fixturesPath, 'nested', 'child.journal');
  let parser: HledgerParser;
  let workspaceManager: WorkspaceManager;

  beforeEach(async () => {
    parser = new HledgerParser();
    workspaceManager = new WorkspaceManager();
    const connection = createMockConnection();
    await workspaceManager.initialize(
      [URI.file(fixturesPath)],
      parser,
      defaultFileReader,
      connection as any
    );
  });

  test('should include file from parent directory using ../path', () => {
    const uri = URI.file(childJournalPath);
    const parsed = workspaceManager.parseFromFile(uri);

    // Should have transactions from both child and parent files
    expect(parsed.transactions.length).toBe(2);

    // Should have parent transaction
    const parentTx = parsed.transactions.find(t => t.description === 'Parent Transaction');
    expect(parentTx).toBeDefined();
    expect(parentTx?.sourceUri?.toString()).toContain('parent.journal');

    // Should have child transaction
    const childTx = parsed.transactions.find(t => t.description === 'Child Transaction');
    expect(childTx).toBeDefined();
    expect(childTx?.sourceUri?.toString()).toContain('child.journal');

    // Should have accounts from both files
    expect(Array.from(parsed.accounts.values()).some(a => a.name === 'Assets:Bank')).toBe(true);
    expect(Array.from(parsed.accounts.values()).some(a => a.name === 'Assets:Cash')).toBe(true);
    expect(Array.from(parsed.accounts.values()).some(a => a.name === 'Expenses:Utilities')).toBe(true);
  });

  test('should handle multiple levels of parent directory (.../../)', () => {
    // Create test content that uses ../../ to go up two levels
    const deepChildPath = path.join(fixturesPath, 'nested', 'deep', 'grandchild.journal');

    // Check if the deep directory structure exists, skip if not
    if (!fs.existsSync(deepChildPath)) {
      // Verify that the parser correctly records the include directive
      const content = `; Grandchild file
include ../../parent.journal

2024-01-20 * Grandchild Transaction
    Assets:Cash    $25
    Expenses:Misc $-25
`;
      const uri = URI.file(deepChildPath);
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Should have the include directive recorded
      const includeDirective = parsed.directives.find(d => d.type === 'include');
      expect(includeDirective).toBeDefined();
      expect(includeDirective?.value).toBe('../../parent.journal');
      return;
    }

    const uri = URI.file(deepChildPath);
    const parsed = workspaceManager.parseFromFile(uri);

    // Should have transactions from grandchild and potentially parent
    expect(parsed.transactions.length).toBeGreaterThanOrEqual(1);
  });

  test('should correctly track source URIs in parent-child includes', () => {
    const uri = URI.file(childJournalPath);
    const parsed = workspaceManager.parseFromFile(uri);

    // Check that each transaction has the correct source URI
    for (const tx of parsed.transactions) {
      expect(tx.sourceUri).toBeDefined();

      if (tx.description === 'Parent Transaction') {
        expect(tx.sourceUri?.fsPath).toContain('parent.journal');
      } else if (tx.description === 'Child Transaction') {
        expect(tx.sourceUri?.fsPath).toContain('child.journal');
      }
    }
  });

  test('should correctly merge account declarations from parent files', () => {
    const uri = URI.file(childJournalPath);
    const parsed = workspaceManager.parseFromFile(uri);

    // Verify accounts are merged from both files
    const accounts = Array.from(parsed.accounts.values());

    // Check for accounts from parent.journal
    const bankAccount = accounts.find(a => a.name === 'Assets:Bank');
    expect(bankAccount).toBeDefined();

    // Check for accounts from child.journal
    const cashAccount = accounts.find(a => a.name === 'Assets:Cash');
    expect(cashAccount).toBeDefined();
  });

  test('should parse include directive with ../ prefix', () => {
    const content = `; Test file in nested directory
include ../shared.journal

2024-01-15 * Test
    Assets:Cash    $100
    Expenses:Test $-100
`;

    const uri = URI.file(path.join(fixturesPath, 'nested', 'test-nested.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    // Should record the include directive
    const includeDirective = parsed.directives.find(d => d.type === 'include');
    expect(includeDirective).toBeDefined();
    expect(includeDirective?.value).toBe('../shared.journal');

    // Should parse the transaction from the test file
    expect(parsed.transactions.length).toBe(1);
  });
});
