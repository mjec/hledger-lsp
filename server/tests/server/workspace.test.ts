import { WorkspaceManager } from '../../src/server/workspace';
import { HledgerParser, FileReader } from '../../src/parser';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Connection } from 'vscode-languageserver/node';

// Mock the Connection interface
const mockConnection = {
  console: {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
} as unknown as Connection;

// Mock fast-glob
jest.mock('fast-glob', () => {
  const mockFn = (patterns: string[], options: any) => {
    // Return mocked file paths based on the cwd
    const cwd = options?.cwd || '';

    if (cwd.endsWith('workspace1')) {
      return Promise.resolve([
        `${cwd}/main.journal`,
        `${cwd}/expenses.journal`,
        `${cwd}/income.journal`,
        `${cwd}/2024/jan.journal`,
        `${cwd}/2024/feb.journal`
      ]);
    } else if (cwd.endsWith('workspace2')) {
      return Promise.resolve([
        `${cwd}/personal.journal`,
        `${cwd}/business.journal`
      ]);
    } else if (cwd.endsWith('empty')) {
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  };

  // Add sync method
  mockFn.sync = (patterns: string | string[], options: any) => {
    const cwd = options?.cwd || '';
    const pattern = Array.isArray(patterns) ? patterns[0] : patterns;

    // For include resolution (glob patterns)
    if (pattern && pattern.includes('*')) {
      if (pattern.includes('2024')) {
        return [
          `${cwd}/2024/jan.journal`,
          `${cwd}/2024/feb.journal`
        ];
      }
    }

    return [];
  };

  return mockFn;
});

describe('WorkspaceManager', () => {
  let manager: WorkspaceManager;
  let parser: HledgerParser;
  let fileReader: FileReader;

  beforeEach(() => {
    manager = new WorkspaceManager();
    parser = new HledgerParser();
    jest.clearAllMocks();

    // Create a mock fileReader that returns appropriate documents
    fileReader = (uri: string): TextDocument | null => {
      if (uri.includes('main.journal')) {
        return TextDocument.create(
          uri,
          'hledger',
          1,
          `include expenses.journal
include income.journal
include 2024/*.journal`
        );
      } else if (uri.includes('expenses.journal')) {
        return TextDocument.create(
          uri,
          'hledger',
          1,
          `2024-01-01 * Grocery
    expenses:food  $50.00
    assets:checking`
        );
      } else if (uri.includes('income.journal')) {
        return TextDocument.create(
          uri,
          'hledger',
          1,
          `2024-01-15 * Salary
    income:salary  -$1000.00
    assets:checking`
        );
      } else if (uri.includes('jan.journal')) {
        return TextDocument.create(
          uri,
          'hledger',
          1,
          `2024-01-05 * Gas
    expenses:auto  $40.00
    assets:checking`
        );
      } else if (uri.includes('feb.journal')) {
        return TextDocument.create(
          uri,
          'hledger',
          1,
          `2024-02-01 * Electric
    expenses:utilities  $60.00
    assets:checking`
        );
      } else if (uri.includes('personal.journal')) {
        return TextDocument.create(
          uri,
          'hledger',
          1,
          `2024-01-01 * Personal expense
    expenses:personal  $100.00
    assets:checking`
        );
      } else if (uri.includes('business.journal')) {
        return TextDocument.create(
          uri,
          'hledger',
          1,
          `2024-01-01 * Business expense
    expenses:business  $200.00
    assets:checking`
        );
      }

      return null;
    };
  });

  describe('initialization', () => {
    test('should discover journal files in workspace', async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.totalFiles).toBe(5);
    });

    test('should discover files in multiple workspace folders', async () => {
      await manager.initialize(
        ['file:///workspace1', 'file:///workspace2'],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.totalFiles).toBe(7); // 5 + 2
    });

    test('should handle empty workspace', async () => {
      await manager.initialize(
        ['file:///empty'],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.totalFiles).toBe(0);
    });
  });

  describe('root file detection', () => {
    test('should detect file with no parents as root', async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.rootFiles).toBeGreaterThan(0);

      // main.journal should be a root (it includes others but isn't included)
      const rootForMain = manager.getRootForFile('file:///workspace1/main.journal');
      expect(rootForMain).toBe('file:///workspace1/main.journal');
    });

    test('should detect files that include many others as roots', async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );

      // main.journal includes 3+ files, should be detected as root
      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.rootFiles).toBeGreaterThan(0);
    });

    test('should treat all files as roots when no clear root exists', async () => {
      // Create a workspace with disconnected files
      await manager.initialize(
        ['file:///workspace2'],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      // Both personal.journal and business.journal should be roots
      expect(diagnostics.rootFiles).toBe(2);
    });
  });

  describe('getRootForFile', () => {
    beforeEach(async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should return root for leaf file', () => {
      const root = manager.getRootForFile('file:///workspace1/expenses.journal');
      expect(root).toBe('file:///workspace1/main.journal');
    });

    test('should return self for root file', () => {
      const root = manager.getRootForFile('file:///workspace1/main.journal');
      expect(root).toBe('file:///workspace1/main.journal');
    });

    test('should return null for orphan file', () => {
      const root = manager.getRootForFile('file:///workspace1/orphan.journal');
      expect(root).toBeNull();
    });

    test('should return root for deeply nested file', () => {
      const root = manager.getRootForFile('file:///workspace1/2024/jan.journal');
      expect(root).toBe('file:///workspace1/main.journal');
    });
  });

  describe('workspace parsing', () => {
    beforeEach(async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should parse workspace from root', () => {
      const parsed = manager.parseWorkspace('file:///workspace1/main.journal');

      expect(parsed).toBeDefined();
      expect(parsed.transactions).toBeDefined();
      expect(parsed.accounts).toBeDefined();
    });

    test('should cache parsed workspace', () => {
      const parsed1 = manager.parseWorkspace('file:///workspace1/main.journal');
      const diagnostics1 = manager.getDiagnosticInfo();
      expect(diagnostics1.cacheSize).toBe(1);

      const parsed2 = manager.parseWorkspace('file:///workspace1/main.journal');
      expect(parsed2).toBe(parsed1); // Same object (cached)
    });

    test('should force re-parse when requested', () => {
      const parsed1 = manager.parseWorkspace('file:///workspace1/main.journal');
      const parsed2 = manager.parseWorkspace('file:///workspace1/main.journal', true);

      // Different objects (re-parsed)
      expect(parsed2).not.toBe(parsed1);
    });

    test('should throw error for missing root file', () => {
      expect(() =>
        manager.parseWorkspace('file:///workspace1/missing.journal')
      ).toThrow('Root file not found');
    });
  });

  describe('cache invalidation', () => {
    beforeEach(async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should invalidate cache for affected roots', () => {
      // Parse and cache
      manager.parseWorkspace('file:///workspace1/main.journal');
      let diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cacheSize).toBe(1);

      // Invalidate a leaf file
      manager.invalidateFile('file:///workspace1/expenses.journal');

      // Cache should be cleared for main.journal (which includes expenses)
      diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cacheSize).toBe(0);
    });

    test('should not affect unrelated roots', async () => {
      // This test would work with multiple roots
      await manager.initialize(
        ['file:///workspace2'],
        parser,
        fileReader,
        mockConnection
      );

      manager.parseWorkspace('file:///workspace2/personal.journal');
      manager.parseWorkspace('file:///workspace2/business.journal');

      let diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cacheSize).toBe(2);

      // Invalidate personal - should not affect business
      manager.invalidateFile('file:///workspace2/personal.journal');

      diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cacheSize).toBe(1);
    });
  });

  describe('include graph construction', () => {
    beforeEach(async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should build include graph correctly', async () => {
      // main.journal includes expenses, income, and 2024/*.journal files
      const root = manager.getRootForFile('file:///workspace1/main.journal');
      expect(root).toBe('file:///workspace1/main.journal');

      // All included files should resolve to main.journal as root
      expect(manager.getRootForFile('file:///workspace1/expenses.journal')).toBe('file:///workspace1/main.journal');
      expect(manager.getRootForFile('file:///workspace1/income.journal')).toBe('file:///workspace1/main.journal');
      expect(manager.getRootForFile('file:///workspace1/2024/jan.journal')).toBe('file:///workspace1/main.journal');
      expect(manager.getRootForFile('file:///workspace1/2024/feb.journal')).toBe('file:///workspace1/main.journal');
    });
  });

  describe('multiple roots', () => {
    test('should prefer root from same workspace folder', async () => {
      // This test verifies that when a file could belong to multiple roots,
      // we prefer the root from the same workspace folder

      await manager.initialize(
        ['file:///workspace1', 'file:///workspace2'],
        parser,
        fileReader,
        mockConnection
      );

      // expenses.journal is in workspace1 and included by main.journal
      const root1 = manager.getRootForFile('file:///workspace1/expenses.journal');
      expect(root1).toBe('file:///workspace1/main.journal');

      // personal.journal is in workspace2
      const root2 = manager.getRootForFile('file:///workspace2/personal.journal');
      expect(root2).toBe('file:///workspace2/personal.journal'); // It's a root itself
    });
  });

  describe('diagnostic info', () => {
    test('should provide accurate diagnostic information', async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();

      expect(diagnostics.totalFiles).toBeGreaterThan(0);
      expect(diagnostics.rootFiles).toBeGreaterThan(0);
      expect(diagnostics.cacheSize).toBe(0); // No parsing done yet

      manager.parseWorkspace('file:///workspace1/main.journal');

      const diagnostics2 = manager.getDiagnosticInfo();
      expect(diagnostics2.cacheSize).toBe(1);
    });
  });

  describe('getWorkspaceGraph', () => {
    test('should generate mermaid graph', async () => {
      await manager.initialize(
        ['file:///workspace1'],
        parser,
        fileReader,
        mockConnection
      );

      const graph = manager.getWorkspaceGraph();
      expect(graph).toContain('graph TD');
      expect(graph).toContain('main.journal (Root)');
      expect(graph).toContain('expenses.journal');
      expect(graph).toContain('-->');
      expect(graph).toContain('classDef root');
    });
  });
});
