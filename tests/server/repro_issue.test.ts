import { URI } from 'vscode-uri';
import { WorkspaceManager } from '../../src/server/workspace';
import { HledgerParser } from '../../src/parser';
import { FileReader } from '../../src/types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Connection } from 'vscode-languageserver/node';

// Mock the Connection interface
const mockConnection = {
  console: {
    log: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
} as unknown as Connection;

// Mock fast-glob
jest.mock('fast-glob', () => {
  const mockFn = (_patterns: string[], options: any) => {
    const cwd = options?.cwd || '';
    // Simulate user's workspace
    if (cwd.endsWith('fixtures')) {
      return Promise.resolve([
        `${cwd}/test-workspace-1/main.journal`,
        `${cwd}/test-workspace-1/expenses.journal`
      ]);
    }
    return Promise.resolve([]);
  };
  return mockFn;
});

describe('Reproduction of Issue', () => {
  let manager: WorkspaceManager;
  let parser: HledgerParser;
  let fileReader: FileReader;

  beforeEach(() => {
    manager = new WorkspaceManager();
    parser = new HledgerParser();
    jest.clearAllMocks();

    fileReader = (uri: URI): TextDocument | null => {
      const uriStr = uri.toString();
      if (uriStr.includes('main.journal')) {
        return TextDocument.create(uriStr, 'hledger', 1, 'include expenses.journal');
      } else if (uriStr.includes('expenses.journal')) {
        return TextDocument.create(uriStr, 'hledger', 1, '2024-01-01 * Test\n    expenses:food  $10\n    assets:checking');
      }
      return null;
    };
  });

  test('should find root for file in subdirectory', async () => {
    await manager.initialize(
      [URI.parse('file:///home/patrick/Development/hledger_lsp/server/tests/fixtures')],
      parser,
      fileReader,
      mockConnection
    );

    const mainUri = URI.parse('file:///home/patrick/Development/hledger_lsp/server/tests/fixtures/test-workspace-1/main.journal');
    const expensesUri = URI.parse('file:///home/patrick/Development/hledger_lsp/server/tests/fixtures/test-workspace-1/expenses.journal');

    // Verify main.journal is a root
    const rootForMain = manager.getRootForFile(mainUri);
    expect(rootForMain?.toString()).toBe(mainUri.toString());

    // Verify expenses.journal maps to main.journal
    const rootForExpenses = manager.getRootForFile(expensesUri);
    expect(rootForExpenses?.toString()).toBe(mainUri.toString());
  });
});
