/**
 * Tests for configuration file support (.hledger-lsp.json)
 */

import { URI } from 'vscode-uri';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { toFileUri } from '../../src/utils/uri';
import {
  HledgerLspConfig,
  discoverConfigFile,
  loadConfigFile,
  resolveRootFile,
  mergeConfig
} from '../../src/server/configFile';

describe('ConfigFile', () => {
  let tempDir: string;
  const isWindows = process.platform === 'win32';

  // Helper to normalize paths for comparison on Windows (case-insensitive drive letters)
  const normalizePath = (p: string): string => {
    if (!isWindows) return p;
    // Convert drive letter to lowercase for consistent comparison
    return p.replace(/^([A-Z]):/, (match, letter) => letter.toLowerCase() + ':');
  };

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-lsp-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('discoverConfigFile', () => {
    it('should find config file in same directory', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const docPath = path.join(tempDir, 'test.journal');
      fs.writeFileSync(configPath, '{}');
      fs.writeFileSync(docPath, '');

      const found = discoverConfigFile(URI.file(docPath));
      expect(normalizePath(found?.fsPath || '')).toBe(normalizePath(configPath));
    });

    it('should find config file in parent directory', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const subDir = path.join(tempDir, 'sub');
      const docPath = path.join(subDir, 'test.journal');

      fs.mkdirSync(subDir);
      fs.writeFileSync(configPath, '{}');
      fs.writeFileSync(docPath, '');

      const found = discoverConfigFile(URI.file(docPath));
      expect(normalizePath(found?.fsPath || '')).toBe(normalizePath(configPath));
    });

    it('should find config file in grandparent directory', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const subDir1 = path.join(tempDir, 'sub1');
      const subDir2 = path.join(subDir1, 'sub2');
      const docPath = path.join(subDir2, 'test.journal');

      fs.mkdirSync(subDir1);
      fs.mkdirSync(subDir2);
      fs.writeFileSync(configPath, '{}');
      fs.writeFileSync(docPath, '');

      const found = discoverConfigFile(URI.file(docPath));
      expect(normalizePath(found?.fsPath || '')).toBe(normalizePath(configPath));
    });

    it('should return null if no config file found', () => {
      const docPath = path.join(tempDir, 'test.journal');
      fs.writeFileSync(docPath, '');

      const found = discoverConfigFile(URI.file(docPath));
      expect(found).toBeNull();
    });

    it('should stop at workspace root', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const workspaceRoot = path.join(tempDir, 'workspace');
      const subDir = path.join(workspaceRoot, 'sub');
      const docPath = path.join(subDir, 'test.journal');

      fs.writeFileSync(configPath, '{}');
      fs.mkdirSync(workspaceRoot);
      fs.mkdirSync(subDir);
      fs.writeFileSync(docPath, '');

      // Should not find config outside workspace root
      const found = discoverConfigFile(URI.file(docPath), URI.file(workspaceRoot));
      expect(found).toBeNull();
    });

    it('should find config at workspace root', () => {
      const workspaceRoot = path.join(tempDir, 'workspace');
      const configPath = path.join(workspaceRoot, '.hledger-lsp.json');
      const subDir = path.join(workspaceRoot, 'sub');
      const docPath = path.join(subDir, 'test.journal');

      fs.mkdirSync(workspaceRoot);
      fs.writeFileSync(configPath, '{}');
      fs.mkdirSync(subDir);
      fs.writeFileSync(docPath, '');

      const found = discoverConfigFile(URI.file(docPath), URI.file(workspaceRoot));
      expect(normalizePath(found?.fsPath || '')).toBe(normalizePath(configPath));
    });
  });

  describe('loadConfigFile', () => {
    it('should load valid empty config', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{}');

      const result = loadConfigFile(URI.file(configPath));
      expect(result.config).toEqual({});
      expect(normalizePath(result.configPath.fsPath)).toBe(normalizePath(configPath));
      expect(normalizePath(result.configDir.fsPath)).toBe(normalizePath(tempDir));
      expect(result.warnings).toEqual([]);
    });

    it('should load config with rootFile', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const config: HledgerLspConfig = {
        rootFile: 'main.journal'
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const result = loadConfigFile(URI.file(configPath));
      expect(result.config.rootFile).toEqual('main.journal');
      expect(result.warnings).toEqual([]);
    });

    it('should load config with include/exclude patterns', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const config: HledgerLspConfig = {
        include: ['**/*.journal', 'ledger/**/*.hledger'],
        exclude: ['**/archive/**', '**/temp/**']
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const result = loadConfigFile(URI.file(configPath));
      expect(result.config.include).toEqual(['**/*.journal', 'ledger/**/*.hledger']);
      expect(result.config.exclude).toEqual(['**/archive/**', '**/temp/**']);
      expect(result.warnings).toEqual([]);
    });

    it('should load config with workspace settings', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const config: HledgerLspConfig = {
        workspace: {
          enabled: false,
          eagerParsing: false,
          autoDetectRoot: false
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const result = loadConfigFile(URI.file(configPath));
      expect(result.config.workspace).toEqual({
        enabled: false,
        eagerParsing: false,
        autoDetectRoot: false
      });
      expect(result.warnings).toEqual([]);
    });

    it('should warn on invalid rootFile type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"rootFile": ["main.journal"]}');

      const result = loadConfigFile(URI.file(configPath));
      expect(result.warnings).toContain('rootFile should be a string, ignoring');
    });

    it('should warn on invalid include type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"include": "**/*.journal"}');

      const result = loadConfigFile(URI.file(configPath));
      expect(result.warnings).toContain('include should be an array, using defaults');
    });

    it('should warn on invalid exclude type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"exclude": 123}');

      const result = loadConfigFile(URI.file(configPath));
      expect(result.warnings).toContain('exclude should be an array, using defaults');
    });

    it('should warn on invalid workspace settings type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"workspace": "invalid"}');

      const result = loadConfigFile(URI.file(configPath));
      expect(result.warnings).toContain('workspace should be an object, using defaults');
    });

    it('should warn on invalid workspace.enabled type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"workspace": {"enabled": "yes"}}');

      const result = loadConfigFile(URI.file(configPath));
      expect(result.warnings).toContain('workspace.enabled should be a boolean, using default');
    });

    it('should throw on invalid JSON', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{invalid json}');

      expect(() => loadConfigFile(URI.file(configPath))).toThrow(/Invalid JSON/);
    });

    it('should throw on missing file', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      expect(() => loadConfigFile(URI.file(configPath))).toThrow(/Failed to read/);
    });
  });

  describe('resolveRootFile', () => {
    it('should resolve relative path', () => {
      const config: HledgerLspConfig = {
        rootFile: 'main.journal'
      };
      // Use platform-appropriate path
      const configDir = process.platform === 'win32' ? 'C:\\home\\user\\ledger' : '/home/user/ledger';
      const configPath = path.join(configDir, '.hledger-lsp.json');
      const expected = toFileUri(path.join(configDir, 'main.journal'));

      const resolved = resolveRootFile(config, URI.file(configPath));
      expect(resolved?.toString()).toBe(expected.toString());
    });

    it('should resolve relative path in subdirectory', () => {
      const config: HledgerLspConfig = {
        rootFile: 'sub/budget.journal'
      };
      // Use platform-appropriate path
      const configDir = process.platform === 'win32' ? 'C:\\home\\user\\ledger' : '/home/user/ledger';
      const configPath = path.join(configDir, '.hledger-lsp.json');
      const expected = toFileUri(path.join(configDir, 'sub', 'budget.journal'));

      const resolved = resolveRootFile(config, URI.file(configPath));
      expect(resolved?.toString()).toBe(expected.toString());
    });

    it('should handle absolute path', () => {
      const config: HledgerLspConfig = {
        rootFile: '/absolute/path/main.journal'
      };
      const configDir = '/home/user/ledger';

      const resolved = resolveRootFile(config, URI.file(configDir));
      expect(resolved?.toString()).toBe('file:///absolute/path/main.journal');
    });

    it('should return null if no rootFile', () => {
      const config: HledgerLspConfig = {};
      const resolved = resolveRootFile(config, URI.file(tempDir));
      expect(resolved).toBeNull();
    });
  });

  describe('mergeConfig', () => {
    it('should use defaults when no config provided', () => {
      const merged = mergeConfig({});

      expect(merged.rootFile).toBeUndefined();
      expect(merged.include).toEqual(['**/*.journal', '**/*.hledger']);
      expect(merged.exclude).toEqual(['**/node_modules/**', '**/.git/**', '**/.*']);
      expect(merged.workspace.enabled).toBe(true);
      expect(merged.workspace.eagerParsing).toBe(true);
      expect(merged.workspace.autoDetectRoot).toBe(true);
    });

    it('should merge file config with defaults', () => {
      const fileConfig: HledgerLspConfig = {
        rootFile: 'main.journal',
        workspace: {
          enabled: false
        }
      };

      const merged = mergeConfig(fileConfig);

      expect(merged.rootFile).toBe('main.journal');
      expect(merged.include).toEqual(['**/*.journal', '**/*.hledger']);
      expect(merged.workspace.enabled).toBe(false);
      expect(merged.workspace.eagerParsing).toBe(true);
    });

    it('should prioritize runtime settings over file config', () => {
      const fileConfig: HledgerLspConfig = {
        rootFile: 'main.journal',
        include: ['**/*.journal'],
        workspace: {
          enabled: false,
          eagerParsing: false
        }
      };

      const runtimeSettings: Partial<HledgerLspConfig> = {
        rootFile: 'override.journal',
        workspace: {
          enabled: true
        }
      };

      const merged = mergeConfig(fileConfig, runtimeSettings);

      expect(merged.rootFile).toBe('override.journal');
      expect(merged.include).toEqual(['**/*.journal']);
      expect(merged.workspace.enabled).toBe(true);
      expect(merged.workspace.eagerParsing).toBe(false);
    });

    it('should handle partial runtime settings', () => {
      const fileConfig: HledgerLspConfig = {
        rootFile: 'main.journal',
        include: ['**/*.journal']
      };

      const runtimeSettings: Partial<HledgerLspConfig> = {
        exclude: ['**/temp/**']
      };

      const merged = mergeConfig(fileConfig, runtimeSettings);

      expect(merged.rootFile).toBe('main.journal');
      expect(merged.include).toEqual(['**/*.journal']);
      expect(merged.exclude).toEqual(['**/temp/**']);
    });

    it('should handle deep workspace settings merge', () => {
      const fileConfig: HledgerLspConfig = {
        workspace: {
          enabled: false,
          eagerParsing: false,
          autoDetectRoot: false
        }
      };

      const runtimeSettings: Partial<HledgerLspConfig> = {
        workspace: {
          enabled: true
          // eagerParsing and autoDetectRoots not specified
        }
      };

      const merged = mergeConfig(fileConfig, runtimeSettings);

      expect(merged.workspace.enabled).toBe(true);
      expect(merged.workspace.eagerParsing).toBe(false);
      expect(merged.workspace.autoDetectRoot).toBe(false);
    });
  });
});
