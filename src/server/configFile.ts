/**
 * Configuration file support for hledger LSP
 *
 * Allows users to specify workspace configuration via .hledger-lsp.json files.
 * Config files can be placed at any level in the directory hierarchy and are
 * discovered by walking up from the document location.
 */

import * as fs from 'fs';
import * as path from 'path';
import { toFilePath, toFileUri } from '../utils/uri';
import { URI } from 'vscode-uri';

/**
 * Schema for .hledger-lsp.json configuration file
 */
export interface HledgerLspConfig {
  /**
   * Root journal file that serves as the entry point to the workspace.
   * This file is parsed to build the complete include graph.
   * Path is relative to the config file location.
   *
   * Example: "main.journal"
   */
  rootFile?: string;

  /**
   * Glob patterns for files to include in workspace discovery.
   * Default: ["**\/*.journal", "**\/*.hledger"]
   *
   * Example: ["**\/*.journal", "ledger/**\/*.hledger"]
   */
  include?: string[];

  /**
   * Glob patterns for files to exclude from workspace discovery.
   * Default: ["**\/node_modules/**", "**\/.git/**"]
   *
   * Example: ["**\/archive/**", "**\/temp/**", "**\/backup/**"]
   */
  exclude?: string[];

  /**
   * Workspace-specific settings
   */
  workspace?: {
    /**
     * Enable workspace-aware parsing (default: true)
     */
    enabled?: boolean;

    /**
     * Parse all discovered files eagerly on startup (default: true)
     * If false, files are parsed on-demand
     */
    eagerParsing?: boolean;

    /**
     * Automatically detect the root file using heuristics (default: true)
     * If false, only uses explicitly configured rootFile
     */
    autoDetectRoot?: boolean;
  };
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<HledgerLspConfig> = {
  rootFile: undefined as any, // No default root file
  include: ['**/*.journal', '**/*.hledger'],
  exclude: ['**/node_modules/**', '**/.git/**', '**/.*'],
  workspace: {
    enabled: true,
    eagerParsing: true,
    autoDetectRoot: true
  }
};

/**
 * Result of loading a config file
 */
export interface ConfigLoadResult {
  /** The loaded and validated configuration */
  config: HledgerLspConfig;
  /** Absolute path to the config file */
  configPath: URI;
  /** Directory containing the config file (used as base for relative paths) */
  configDir: URI;
  /** Any validation warnings */
  warnings: string[];
}

/**
 * Discover .hledger-lsp.json by walking up the directory tree
 *
 * @param startUri - URI of the document to start searching from
 * @param workspaceRoot - URI of the workspace root (optional, stops search here)
 * @returns Path to the config file, or null if not found
 */
export function discoverConfigFile(startUri: URI, workspaceRoot?: URI): URI | null {
  const filePath = toFilePath(startUri);
  let currentDir = filePath;
  const workspaceRootPath = workspaceRoot ? toFilePath(workspaceRoot) : null;

  // Walk up the directory tree
  while (true) {
    const configPath = path.join(currentDir, '.hledger-lsp.json');
    const configUri = URI.file(configPath);

    if (fs.existsSync(toFilePath(configUri))) {
      return configUri;
    }

    // Stop at workspace root if provided
    if (workspaceRootPath && currentDir === workspaceRootPath) {
      break;
    }

    // Stop at filesystem root
    // This check works on both Unix (/) and Windows (C:\)
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || currentDir === path.parse(currentDir).root) {
      break;
    }

    currentDir = parentDir;
  }

  return null;
}

/**
 * Load and validate a config file
 *
 * @param configPath - Absolute path to the config file
 * @returns Loaded configuration with validation warnings
 * @throws Error if the config file is invalid JSON or cannot be read
 */
export function loadConfigFile(configPath: URI): ConfigLoadResult {
  const warnings: string[] = [];

  // Read and parse JSON
  let rawConfig: any;
  try {
    const content = fs.readFileSync(toFilePath(configPath), 'utf-8');
    rawConfig = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
    }
    throw new Error(`Failed to read ${configPath}: ${error}`);
  }

  // Validate and normalize config
  const config: HledgerLspConfig = {};

  // Validate rootFile
  if (rawConfig.rootFile !== undefined) {
    if (typeof rawConfig.rootFile !== 'string') {
      warnings.push('rootFile should be a string, ignoring');
    } else {
      config.rootFile = rawConfig.rootFile;
    }
  }

  // Validate include
  if (rawConfig.include !== undefined) {
    if (!Array.isArray(rawConfig.include)) {
      warnings.push('include should be an array, using defaults');
    } else {
      const validPatterns = rawConfig.include.filter((p: any) => typeof p === 'string');
      if (validPatterns.length !== rawConfig.include.length) {
        warnings.push('Some include patterns are not strings, ignoring them');
      }
      config.include = validPatterns.length > 0 ? validPatterns : DEFAULT_CONFIG.include;
    }
  }

  // Validate exclude
  if (rawConfig.exclude !== undefined) {
    if (!Array.isArray(rawConfig.exclude)) {
      warnings.push('exclude should be an array, using defaults');
    } else {
      const validPatterns = rawConfig.exclude.filter((p: any) => typeof p === 'string');
      if (validPatterns.length !== rawConfig.exclude.length) {
        warnings.push('Some exclude patterns are not strings, ignoring them');
      }
      config.exclude = validPatterns.length > 0 ? validPatterns : DEFAULT_CONFIG.exclude;
    }
  }

  // Validate workspace settings
  if (rawConfig.workspace !== undefined) {
    if (typeof rawConfig.workspace !== 'object' || rawConfig.workspace === null) {
      warnings.push('workspace should be an object, using defaults');
    } else {
      config.workspace = {};

      if (rawConfig.workspace.enabled !== undefined) {
        if (typeof rawConfig.workspace.enabled !== 'boolean') {
          warnings.push('workspace.enabled should be a boolean, using default');
        } else {
          config.workspace.enabled = rawConfig.workspace.enabled;
        }
      }

      if (rawConfig.workspace.eagerParsing !== undefined) {
        if (typeof rawConfig.workspace.eagerParsing !== 'boolean') {
          warnings.push('workspace.eagerParsing should be a boolean, using default');
        } else {
          config.workspace.eagerParsing = rawConfig.workspace.eagerParsing;
        }
      }

      if (rawConfig.workspace.autoDetectRoot !== undefined) {
        if (typeof rawConfig.workspace.autoDetectRoot !== 'boolean') {
          warnings.push('workspace.autoDetectRoot should be a boolean, using default');
        } else {
          config.workspace.autoDetectRoot = rawConfig.workspace.autoDetectRoot;
        }
      }
    }
  }

  const configDir = URI.file(path.dirname(toFilePath(configPath)));

  return {
    config,
    configPath,
    configDir,
    warnings
  };
}

/**
 * Resolve root file path relative to config directory
 *
 * @param config - The loaded configuration
 * @param configPath - Directory containing the config file
 * @returns Absolute file URI, or null if not configured
 */
export function resolveRootFile(config: HledgerLspConfig, configPath: URI): URI | null {
  if (!config.rootFile) {
    return null;
  }

  const absPath = path.isAbsolute(config.rootFile)
    ? config.rootFile
    : path.resolve(path.dirname(configPath.fsPath), config.rootFile);
  return toFileUri(absPath);
}

/**
 * Merge configuration from file with runtime settings
 *
 * Priority (highest to lowest):
 * 1. Runtime settings (from VS Code configuration)
 * 2. Config file settings
 * 3. Default settings
 *
 * @param fileConfig - Configuration from .hledger-lsp.json
 * @param runtimeSettings - Settings from VS Code
 * @returns Merged configuration
 */
export function mergeConfig(
  fileConfig: HledgerLspConfig,
  runtimeSettings?: Partial<HledgerLspConfig>
): Required<HledgerLspConfig> {
  return {
    rootFile: runtimeSettings?.rootFile ?? fileConfig.rootFile ?? DEFAULT_CONFIG.rootFile,
    include: runtimeSettings?.include ?? fileConfig.include ?? DEFAULT_CONFIG.include,
    exclude: runtimeSettings?.exclude ?? fileConfig.exclude ?? DEFAULT_CONFIG.exclude,
    workspace: {
      enabled: runtimeSettings?.workspace?.enabled ?? fileConfig.workspace?.enabled ?? DEFAULT_CONFIG.workspace.enabled,
      eagerParsing: runtimeSettings?.workspace?.eagerParsing ?? fileConfig.workspace?.eagerParsing ?? DEFAULT_CONFIG.workspace.eagerParsing,
      autoDetectRoot: runtimeSettings?.workspace?.autoDetectRoot ?? fileConfig.workspace?.autoDetectRoot ?? DEFAULT_CONFIG.workspace.autoDetectRoot
    }
  };
}
