/**
 * Tests for including files using absolute paths
 */

import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { defaultFileReader } from '../../src/utils/uri';
import { WorkspaceManager } from '../../src/server/workspace';
import { createMockConnection } from '../helpers/workspaceTestHelper';
import * as path from 'path';

describe('absolute path includes', () => {
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  const absoluteTestPath = path.join(fixturesPath, 'absolute-test.journal');
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

  test('should include file using absolute path', () => {
    const content = `; Main file with absolute include
include ${absoluteTestPath}

account Assets:Checking

2024-01-11 * Main Transaction
    Assets:Checking    $100
    Assets:Bank       $-100
`;

    // For this test, we parse the document directly since the main file isn't in fixtures
    // The parser records the include directive, and we can verify the directive was parsed
    const uri = URI.file(path.join(fixturesPath, 'main-absolute.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc);

    // Should have the main transaction
    expect(parsed.transactions.length).toBe(1);
    const mainTx = parsed.transactions.find(t => t.description === 'Main Transaction');
    expect(mainTx).toBeDefined();

    // Should have the include directive recorded
    const includeDirective = parsed.directives.find(d => d.type === 'include');
    expect(includeDirective).toBeDefined();
    expect(includeDirective?.value).toBe(absoluteTestPath);
  });

  test('should parse absolute-test.journal directly from workspace', () => {
    const uri = URI.file(absoluteTestPath);
    const parsed = workspaceManager.parseFromFile(uri);

    // Should have the absolute test transaction
    const absoluteTx = parsed.transactions.find(t => t.description === 'Absolute Path Test');
    expect(absoluteTx).toBeDefined();
    expect(absoluteTx?.sourceUri?.toString()).toContain('absolute-test.journal');
  });

  test('should include file using absolute path starting with /', () => {
    // Skip on Windows - leading / means something different there
    if (process.platform === 'win32') {
      return;
    }

    // This test verifies the absolute path is correctly recorded in the directive
    const content = `include /tmp/test.journal

2024-01-12 * Local Transaction
    Assets:Checking    $50
    Expenses:Food     $-50
`;

    const uri = URI.file(path.join(fixturesPath, 'test-absolute-slash.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc);

    // Should have the include directive with absolute path
    const includeDirective = parsed.directives.find(d => d.type === 'include');
    expect(includeDirective).toBeDefined();
    expect(includeDirective?.value).toBe('/tmp/test.journal');

    // Should still parse the local transaction
    expect(parsed.transactions.length).toBe(1);
  });

  test('should have correct source URI for transactions in included file', () => {
    const uri = URI.file(absoluteTestPath);
    const parsed = workspaceManager.parseFromFile(uri);

    // All transactions in this file should have the correct sourceUri
    for (const tx of parsed.transactions) {
      if (tx.description === 'Absolute Path Test') {
        expect(tx.sourceUri?.toString()).toContain('absolute-test.journal');
      }
    }
  });

  test('should correctly track account sources across included files', () => {
    const uri = URI.file(absoluteTestPath);
    const parsed = workspaceManager.parseFromFile(uri);

    // Assets:Bank should be from the absolute-test.journal
    const bankAccount = parsed.accounts.get('Assets:Bank');
    expect(bankAccount).toBeDefined();
    expect(bankAccount?.sourceUri?.toString()).toContain('absolute-test.journal');
  });
});
