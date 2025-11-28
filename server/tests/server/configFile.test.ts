/**
 * Tests for configuration file support (.hledger-lsp.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  HledgerLspConfig,
  discoverConfigFile,
  loadConfigFile,
  resolveRootFiles,
  mergeConfig
} from '../../src/server/configFile';

describe('ConfigFile', () => {
  let tempDir: string;

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

      const found = discoverConfigFile(`file://${docPath}`);
      expect(found).toBe(configPath);
    });

    it('should find config file in parent directory', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const subDir = path.join(tempDir, 'sub');
      const docPath = path.join(subDir, 'test.journal');

      fs.mkdirSync(subDir);
      fs.writeFileSync(configPath, '{}');
      fs.writeFileSync(docPath, '');

      const found = discoverConfigFile(`file://${docPath}`);
      expect(found).toBe(configPath);
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

      const found = discoverConfigFile(`file://${docPath}`);
      expect(found).toBe(configPath);
    });

    it('should return null if no config file found', () => {
      const docPath = path.join(tempDir, 'test.journal');
      fs.writeFileSync(docPath, '');

      const found = discoverConfigFile(`file://${docPath}`);
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
      const found = discoverConfigFile(`file://${docPath}`, `file://${workspaceRoot}`);
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

      const found = discoverConfigFile(`file://${docPath}`, `file://${workspaceRoot}`);
      expect(found).toBe(configPath);
    });
  });

  describe('loadConfigFile', () => {
    it('should load valid empty config', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{}');

      const result = loadConfigFile(configPath);
      expect(result.config).toEqual({});
      expect(result.configPath).toBe(configPath);
      expect(result.configDir).toBe(tempDir);
      expect(result.warnings).toEqual([]);
    });

    it('should load config with rootFiles', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const config: HledgerLspConfig = {
        rootFiles: ['main.journal', 'budget.journal']
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const result = loadConfigFile(configPath);
      expect(result.config.rootFiles).toEqual(['main.journal', 'budget.journal']);
      expect(result.warnings).toEqual([]);
    });

    it('should load config with include/exclude patterns', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      const config: HledgerLspConfig = {
        include: ['**/*.journal', 'ledger/**/*.hledger'],
        exclude: ['**/archive/**', '**/temp/**']
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const result = loadConfigFile(configPath);
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
          autoDetectRoots: false
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const result = loadConfigFile(configPath);
      expect(result.config.workspace).toEqual({
        enabled: false,
        eagerParsing: false,
        autoDetectRoots: false
      });
      expect(result.warnings).toEqual([]);
    });

    it('should warn on invalid rootFiles type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"rootFiles": "main.journal"}');

      const result = loadConfigFile(configPath);
      expect(result.warnings).toContain('rootFiles should be an array, ignoring');
    });

    it('should filter out non-string rootFiles', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"rootFiles": ["main.journal", 123, "budget.journal"]}');

      const result = loadConfigFile(configPath);
      expect(result.config.rootFiles).toEqual(['main.journal', 'budget.journal']);
      expect(result.warnings).toContain('Some rootFiles entries are not strings, ignoring them');
    });

    it('should warn on invalid include type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"include": "**/*.journal"}');

      const result = loadConfigFile(configPath);
      expect(result.warnings).toContain('include should be an array, using defaults');
    });

    it('should warn on invalid exclude type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"exclude": 123}');

      const result = loadConfigFile(configPath);
      expect(result.warnings).toContain('exclude should be an array, using defaults');
    });

    it('should warn on invalid workspace settings type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"workspace": "invalid"}');

      const result = loadConfigFile(configPath);
      expect(result.warnings).toContain('workspace should be an object, using defaults');
    });

    it('should warn on invalid workspace.enabled type', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{"workspace": {"enabled": "yes"}}');

      const result = loadConfigFile(configPath);
      expect(result.warnings).toContain('workspace.enabled should be a boolean, using default');
    });

    it('should throw on invalid JSON', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      fs.writeFileSync(configPath, '{invalid json}');

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid JSON/);
    });

    it('should throw on missing file', () => {
      const configPath = path.join(tempDir, '.hledger-lsp.json');
      expect(() => loadConfigFile(configPath)).toThrow(/Failed to read/);
    });
  });

  describe('resolveRootFiles', () => {
    it('should resolve relative paths', () => {
      const config: HledgerLspConfig = {
        rootFiles: ['main.journal', 'sub/budget.journal']
      };
      const configDir = '/home/user/ledger';

      const resolved = resolveRootFiles(config, configDir);
      expect(resolved).toEqual([
        'file:///home/user/ledger/main.journal',
        'file:///home/user/ledger/sub/budget.journal'
      ]);
    });

    it('should handle absolute paths', () => {
      const config: HledgerLspConfig = {
        rootFiles: ['/absolute/path/main.journal']
      };
      const configDir = '/home/user/ledger';

      const resolved = resolveRootFiles(config, configDir);
      expect(resolved).toEqual(['file:///absolute/path/main.journal']);
    });

    it('should return empty array if no rootFiles', () => {
      const config: HledgerLspConfig = {};
      const resolved = resolveRootFiles(config, tempDir);
      expect(resolved).toEqual([]);
    });

    it('should return empty array if rootFiles is empty', () => {
      const config: HledgerLspConfig = { rootFiles: [] };
      const resolved = resolveRootFiles(config, tempDir);
      expect(resolved).toEqual([]);
    });
  });

  describe('mergeConfig', () => {
    it('should use defaults when no config provided', () => {
      const merged = mergeConfig({});

      expect(merged.rootFiles).toEqual([]);
      expect(merged.include).toEqual(['**/*.journal', '**/*.hledger']);
      expect(merged.exclude).toEqual(['**/node_modules/**', '**/.git/**', '**/.*']);
      expect(merged.workspace.enabled).toBe(true);
      expect(merged.workspace.eagerParsing).toBe(true);
      expect(merged.workspace.autoDetectRoots).toBe(true);
    });

    it('should merge file config with defaults', () => {
      const fileConfig: HledgerLspConfig = {
        rootFiles: ['main.journal'],
        workspace: {
          enabled: false
        }
      };

      const merged = mergeConfig(fileConfig);

      expect(merged.rootFiles).toEqual(['main.journal']);
      expect(merged.include).toEqual(['**/*.journal', '**/*.hledger']);
      expect(merged.workspace.enabled).toBe(false);
      expect(merged.workspace.eagerParsing).toBe(true);
    });

    it('should prioritize runtime settings over file config', () => {
      const fileConfig: HledgerLspConfig = {
        rootFiles: ['main.journal'],
        include: ['**/*.journal'],
        workspace: {
          enabled: false,
          eagerParsing: false
        }
      };

      const runtimeSettings: Partial<HledgerLspConfig> = {
        rootFiles: ['override.journal'],
        workspace: {
          enabled: true
        }
      };

      const merged = mergeConfig(fileConfig, runtimeSettings);

      expect(merged.rootFiles).toEqual(['override.journal']);
      expect(merged.include).toEqual(['**/*.journal']);
      expect(merged.workspace.enabled).toBe(true);
      expect(merged.workspace.eagerParsing).toBe(false);
    });

    it('should handle partial runtime settings', () => {
      const fileConfig: HledgerLspConfig = {
        rootFiles: ['main.journal'],
        include: ['**/*.journal']
      };

      const runtimeSettings: Partial<HledgerLspConfig> = {
        exclude: ['**/temp/**']
      };

      const merged = mergeConfig(fileConfig, runtimeSettings);

      expect(merged.rootFiles).toEqual(['main.journal']);
      expect(merged.include).toEqual(['**/*.journal']);
      expect(merged.exclude).toEqual(['**/temp/**']);
    });

    it('should handle deep workspace settings merge', () => {
      const fileConfig: HledgerLspConfig = {
        workspace: {
          enabled: false,
          eagerParsing: false,
          autoDetectRoots: false
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
      expect(merged.workspace.autoDetectRoots).toBe(false);
    });
  });
});
