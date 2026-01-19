import { URI } from 'vscode-uri';
import { WorkspaceManager } from '../../src/server/workspace';
import { HledgerParser, } from '../../src/parser';
import { FileReader } from '../../src/types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Connection } from 'vscode-languageserver/node';
import * as path from 'path';

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
  const mockFn = jest.fn((_patterns: string[], options: any) => {
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
  });

  // Add sync method
  (mockFn as any).sync = jest.fn((patterns: string | string[], options: any) => {
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
  });

  return mockFn;
});

// Mock configFile
jest.mock('../../src/server/configFile', () => {
  const originalModule = jest.requireActual('../../src/server/configFile');
  return {
    ...originalModule,
    discoverConfigFile: jest.fn(),
    loadConfigFile: jest.fn(),
    resolveRootFile: originalModule.resolveRootFile,
    mergeConfig: originalModule.mergeConfig
  };
});

import { discoverConfigFile, loadConfigFile } from '../../src/server/configFile';

describe('WorkspaceManager', () => {
  let manager: WorkspaceManager;
  let parser: HledgerParser;
  let fileReader: FileReader;

  // Cast mocks to jest.Mock
  const mockDiscoverConfigFile = discoverConfigFile as jest.Mock;
  const mockLoadConfigFile = loadConfigFile as jest.Mock;

  beforeEach(() => {
    manager = new WorkspaceManager();
    parser = new HledgerParser();
    jest.clearAllMocks();

    // Default mock implementations
    mockDiscoverConfigFile.mockReturnValue(null);
    mockLoadConfigFile.mockReturnValue({
      config: {},
      configPath: URI.file('/workspace1/.hledger-lsp.json'),
      configDir: URI.file('/workspace1'),
      warnings: []
    });

    // Create a mock fileReader that returns appropriate documents
    fileReader = (uri: URI): TextDocument | null => {
      if (uri.toString().includes('main.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `include expenses.journal
include income.journal
include 2024/*.journal`
        );
      } else if (uri.toString().includes('expenses.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `2024-01-01 * Grocery
    expenses:food  $50.00
    assets:checking`
        );
      } else if (uri.toString().includes('income.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `2024-01-15 * Salary
    income:salary  -$1000.00
    assets:checking`
        );
      } else if (uri.toString().includes('jan.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `2024-01-05 * Gas
    expenses:auto  $40.00
    assets:checking`
        );
      } else if (uri.toString().includes('feb.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `2024-02-01 * Electric
    expenses:utilities  $60.00
    assets:checking`
        );
      } else if (uri.toString().includes('personal.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `2024-01-01 * Personal expense
    expenses:personal  $100.00
    assets:checking`
        );
      } else if (uri.toString().includes('business.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `2024-01-01 * Business expense
    expenses:business  $200.00
    assets:checking`
        );
      } else if (uri.toString().includes('absolute_include.journal')) {
        return TextDocument.create(
          uri.toString(),
          'hledger',
          1,
          `include /workspace1/expenses.journal`
        );
      }

      return null;
    };
  });

  describe('initialization', () => {
    test('should discover journal files in workspace', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.totalFiles).toBe(5);
    });

    test('should discover files in multiple workspace folders', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1'), URI.parse('file:///workspace2')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.totalFiles).toBe(7); // 5 + 2
    });

    test('should handle empty workspace', async () => {
      await manager.initialize(
        [URI.parse('file:///empty')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.totalFiles).toBe(0);
    });

    test('should warn if workspace is large', async () => {
      // Mock fast-glob to return 101 files
      const largeFileList = Array.from({ length: 101 }, (_, i) => `/workspace1/file${i}.journal`);
      // Update the mock directly
      const mockFg = require('fast-glob');
      // @ts-ignore
      mockFg.mockImplementationOnce(() => Promise.resolve(largeFileList));

      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(mockConnection.console.warn).toHaveBeenCalledWith(expect.stringContaining('Large workspace detected'));
    });

    test('should warn if initialization is slow', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(7000); // 6000ms difference

      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(mockConnection.console.warn).toHaveBeenCalledWith(expect.stringContaining('Workspace initialization took'));

      nowSpy.mockRestore();
    });
  });

  describe('configuration loading', () => {
    test('should load configuration if file exists', async () => {
      mockDiscoverConfigFile.mockReturnValue(URI.file('/workspace1/.hledger-lsp.json'));
      mockLoadConfigFile.mockReturnValue({
        config: { rootFile: 'main.journal' },
        configPath: URI.file('/workspace1/.hledger-lsp.json'),
        configDir: URI.file('/workspace1'),
        warnings: []
      });

      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(mockConnection.console.log).toHaveBeenCalledWith(expect.stringContaining('Loaded configuration'));
    });

    test('should handle config load errors', async () => {
      mockDiscoverConfigFile.mockReturnValue(URI.file('/workspace1/.hledger-lsp.json'));
      mockLoadConfigFile.mockImplementation(() => { throw new Error('Failed to read'); });

      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(mockConnection.console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to load config file'));
    });

    test('should log warnings from config loading', async () => {
      mockDiscoverConfigFile.mockReturnValue(URI.file('/workspace1/.hledger-lsp.json'));
      mockLoadConfigFile.mockReturnValue({
        config: {},
        configPath: URI.file('/workspace1/.hledger-lsp.json'),
        configDir: URI.file('/workspace1'),
        warnings: ['Invalid setting']
      });

      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(mockConnection.console.warn).toHaveBeenCalledWith(expect.stringContaining('Warnings in'));
    });
  });

  describe('root file detection', () => {
    test('should detect file with no parents as root', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.rootFile?.toString()).toBe('file:///workspace1/main.journal');

      // main.journal should be the root (it includes others but isn't included)
      const rootForMain = manager.getRootForFile(URI.parse('file:///workspace1/main.journal'))?.toString();
      expect(rootForMain).toBe('file:///workspace1/main.journal');
    });

    test('should detect file that includes many others as root', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      // main.journal includes 3+ files, should be detected as root
      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.rootFile?.toString()).toBe('file:///workspace1/main.journal');
    });

    test('should select best root when multiple candidates exist', async () => {
      // Create a workspace with disconnected files
      await manager.initialize(
        [URI.parse('file:///workspace2')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      // Should pick one of the two files (alphabetically: business.journal comes first)
      expect(diagnostics.rootFile?.toString()).toBe('file:///workspace2/business.journal');
    });

    test('should use explicit root from config', async () => {
      // Use platform-appropriate paths
      const { toFileUri } = require('../../src/utils/uri');
      const workspaceDir = process.platform === 'win32' ? 'C:\\workspace1' : '/workspace1';
      const configPath = path.join(workspaceDir, '.hledger-lsp.json');
      const workspaceUri = toFileUri(workspaceDir);
      const expectedRoot = toFileUri(path.join(workspaceDir, 'expenses.journal'));

      mockDiscoverConfigFile.mockReturnValue(URI.file(configPath));
      mockLoadConfigFile.mockReturnValue({
        config: { rootFile: 'expenses.journal' }, // Explicitly pick a child as root
        configPath: URI.file(configPath),
        configDir: URI.file(workspaceDir),
        warnings: []
      });

      await manager.initialize(
        [URI.parse(workspaceUri)],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.rootFile?.toString()).toBe(expectedRoot.toString());
      expect(mockConnection.console.log).toHaveBeenCalledWith(expect.stringContaining('Using explicit root'));
    });

    test('should warn if configured root not found', async () => {
      mockDiscoverConfigFile.mockReturnValue(URI.file('/workspace1/.hledger-lsp.json'));
      mockLoadConfigFile.mockReturnValue({
        config: { rootFile: 'missing.journal' },
        configPath: URI.file('/workspace1/.hledger-lsp.json'),
        configDir: URI.file('/workspace1'),
        warnings: []
      });

      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(mockConnection.console.warn).toHaveBeenCalledWith(expect.stringContaining('Configured root file not found'));
    });

    test('should disable features if auto-detect disabled and no root', async () => {
      mockDiscoverConfigFile.mockReturnValue(URI.file('/workspace1/.hledger-lsp.json'));
      mockLoadConfigFile.mockReturnValue({
        config: { workspace: { autoDetectRoot: false } },
        configPath: URI.file('/workspace1/.hledger-lsp.json'),
        configDir: URI.file('/workspace1'),
        warnings: []
      });

      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.rootFile).toBeNull();
      expect(mockConnection.console.warn).toHaveBeenCalledWith(expect.stringContaining('workspace features disabled'));
    });
  });

  describe('getRootForFile', () => {
    beforeEach(async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should return root for leaf file', () => {
      const root = manager.getRootForFile(URI.parse('file:///workspace1/expenses.journal'));
      expect(root?.toString()).toBe('file:///workspace1/main.journal');
    });

    test('should return self for root file', () => {
      const root = manager.getRootForFile(URI.parse('file:///workspace1/main.journal'));
      expect(root?.toString()).toBe('file:///workspace1/main.journal');
    });

    test('should return null for orphan file', () => {
      const root = manager.getRootForFile(URI.parse('file:///workspace1/orphan.journal'));
      expect(root).toBeNull();
    });

    test('should return root for deeply nested file', () => {
      const root = manager.getRootForFile(URI.parse('file:///workspace1/2024/jan.journal'));
      expect(root?.toString()).toBe('file:///workspace1/main.journal');
    });

    test('should return null if no root file identified', async () => {
      // Initialize with autoDetectRoot: false
      const noRootManager = new WorkspaceManager();
      mockDiscoverConfigFile.mockReturnValue(URI.file('/workspace1/.hledger-lsp.json'));
      mockLoadConfigFile.mockReturnValue({
        config: { workspace: { autoDetectRoot: false } },
        configPath: URI.file('/workspace1/.hledger-lsp.json'),
        configDir: URI.file('/workspace1'),
        warnings: []
      });

      await noRootManager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(noRootManager.getRootForFile(URI.parse('file:///workspace1/main.journal'))).toBeNull();
    });
  });

  describe('workspace parsing', () => {
    beforeEach(async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should parse workspace from root', () => {
      const parsed = manager.parseWorkspace();

      expect(parsed).toBeDefined();
      expect(parsed!.transactions).toBeDefined();
      expect(parsed!.accounts).toBeDefined();
    });

    test('should cache parsed workspace', () => {
      const parsed1 = manager.parseWorkspace();
      const diagnostics1 = manager.getDiagnosticInfo();
      expect(diagnostics1.cached).toBe(true);

      const parsed2 = manager.parseWorkspace();
      expect(parsed2).toBe(parsed1); // Same object (cached)
    });

    test('should force re-parse when requested', () => {
      const parsed1 = manager.parseWorkspace();
      const parsed2 = manager.parseWorkspace(true);

      // Different objects (re-parsed)
      expect(parsed2).not.toBe(parsed1);
    });

    test('should return null if no root file', async () => {
      const noRootManager = new WorkspaceManager();
      // Initialize with options that result in no root
      mockDiscoverConfigFile.mockReturnValue(URI.file('/workspace1/.hledger-lsp.json'));
      mockLoadConfigFile.mockReturnValue({
        config: { workspace: { autoDetectRoot: false } },
        configPath: URI.file('/workspace1/.hledger-lsp.json'),
        configDir: URI.file('/workspace1'),
        warnings: []
      });

      await noRootManager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      expect(noRootManager.parseWorkspace()).toBeNull();
    });

    test('should throw if root file cannot be read', async () => {
      // Initialize normally
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      // Make fileReader fail for root
      const brokenFileReader = (_uri: URI) => null;
      // Re-initialize or just use a new manager with broken reader? 
      // We can just spy on fileReader but we passed it as a function.
      // Let's create a new manager instance
      const brokenManager = new WorkspaceManager();
      await brokenManager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        brokenFileReader,
        mockConnection
      );

      // We need to valid root file but then fail to read it during parseWorkspace
      // This is tricky because initialize also reads files to build graph.
      // But initialize uses buildIncludeGraph which handles read failures gracefully.

      // Let's assume we somehow have a root file but it fails to read later.
      // We can manually set the root file on a new manager? No internal field.

      // Since we can't easily reproduce this without complex mocking of fileReader state change,
      // we'll skip this specific edge case or try to setup fileReader to succeed first then fail.

      let shouldFail = false;
      const statefulFileReader = (uri: URI) => {
        if (shouldFail && uri.toString().includes('main.journal')) return null;
        return fileReader(uri);
      };

      const statefulManager = new WorkspaceManager();
      await statefulManager.initialize([URI.parse('file:///workspace1')], parser, statefulFileReader, mockConnection);

      shouldFail = true;
      expect(() => statefulManager.parseWorkspace(true)).toThrow('Root file not found');
    });

    test('should warn on slow parse', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2500); // 1500ms difference

      manager.parseWorkspace();

      expect(mockConnection.console.warn).toHaveBeenCalledWith(expect.stringContaining('Slow parse detected'));

      nowSpy.mockRestore();
    });
  });

  describe('cache invalidation', () => {
    beforeEach(async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should invalidate cache when included file changes', () => {
      // Parse and cache
      manager.parseWorkspace();
      let diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cached).toBe(true);

      // Invalidate a leaf file
      manager.invalidateFile(URI.parse('file:///workspace1/expenses.journal'));

      // Cache should be cleared for the workspace (main.journal includes expenses)
      diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cached).toBe(false);
    });

    test('should not invalidate cache for unrelated files', () => {
      // Parse and cache
      manager.parseWorkspace();
      let diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cached).toBe(true);

      // Invalidate a file that's not part of the include graph
      manager.invalidateFile(URI.parse('file:///workspace1/orphan.journal'));

      // Cache should still be valid
      diagnostics = manager.getDiagnosticInfo();
      expect(diagnostics.cached).toBe(true);
    });
  });

  describe('include graph construction', () => {
    beforeEach(async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );
    });

    test('should build include graph correctly', async () => {
      // main.journal includes expenses, income, and 2024/*.journal files
      const root = manager.getRootForFile(URI.parse('file:///workspace1/main.journal'));
      expect(root?.toString()).toBe('file:///workspace1/main.journal');

      // All included files should resolve to main.journal as root
      expect(manager.getRootForFile(URI.parse('file:///workspace1/expenses.journal'))?.toString()).toBe('file:///workspace1/main.journal');
      expect(manager.getRootForFile(URI.parse('file:///workspace1/income.journal'))?.toString()).toBe('file:///workspace1/main.journal');
      expect(manager.getRootForFile(URI.parse('file:///workspace1/2024/jan.journal'))?.toString()).toBe('file:///workspace1/main.journal');
      expect(manager.getRootForFile(URI.parse('file:///workspace1/2024/feb.journal'))?.toString()).toBe('file:///workspace1/main.journal');
    });

  });

  describe('multiple workspace folders', () => {
    test('should select single root across all workspace folders', async () => {
      // With multiple workspace folders, we still select only one root
      await manager.initialize(
        [URI.parse('file:///workspace1'), URI.parse('file:///workspace2')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();
      // Should have exactly one root file
      expect(diagnostics.rootFile).toBeTruthy();

      // The root should be main.journal since it has the most includes
      expect(diagnostics.rootFile?.toString()).toBe('file:///workspace1/main.journal');
    });
  });

  describe('diagnostic info', () => {
    test('should provide accurate diagnostic information', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      const diagnostics = manager.getDiagnosticInfo();

      expect(diagnostics.totalFiles).toBeGreaterThan(0);
      expect(diagnostics.rootFile?.toString()).toBe('file:///workspace1/main.journal');
      expect(diagnostics.cached).toBe(false); // No parsing done yet

      manager.parseWorkspace();

      const diagnostics2 = manager.getDiagnosticInfo();
      expect(diagnostics2.cached).toBe(true);
    });

    test('should log diagnostics to console', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      manager.logDiagnostics();
      expect(mockConnection.console.log).toHaveBeenCalledWith(expect.stringContaining('=== WorkspaceManager Diagnostics ==='));
    });
  });

  describe('getWorkspaceTree', () => {
    test('should generate text tree', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      const tree = manager.getWorkspaceTree();
      expect(tree).toContain('main.journal');
      expect(tree).toContain('expenses.journal');
      expect(tree).toContain('income.journal');
    });

    test('should return message when no root', async () => {
      // Don't initialize - no root will be identified
      const tree = manager.getWorkspaceTree();
      expect(tree).toBe('No root file identified');
    });
  });

  describe('getWorkspaceTreeStructured', () => {
    test('should return structured tree', async () => {
      await manager.initialize(
        [URI.parse('file:///workspace1')],
        parser,
        fileReader,
        mockConnection
      );

      const tree = manager.getWorkspaceTreeStructured();
      expect(tree).toHaveLength(5); // root + 4 children (jan, feb, expenses, income)
      // collectTreeEntries adds entry for each child.
      // main includes expenses, income, jan, feb.
      // array will have root + flatten children

      expect(tree[0].display).toBe('main.journal');
      expect(tree.find(n => n.uri.toString().includes('expenses.journal'))).toBeDefined();
    });

    test('should return empty array when no root', () => {
      const tree = manager.getWorkspaceTreeStructured();
      expect(tree).toHaveLength(0);
    });
  });

});
