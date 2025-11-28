import { Connection } from 'vscode-languageserver/node';
import fg from 'fast-glob';
import * as path from 'path';
import { HledgerParser, FileReader } from '../parser/index';
import { ParsedDocument, Directive } from '../types';
import { toFilePath, toFileUri } from '../utils/uri';
import { HledgerLspConfig, discoverConfigFile, loadConfigFile, resolveRootFiles, mergeConfig } from './configFile';

export class WorkspaceManager {
  // Core state
  private workspaceFolders: string[] = [];
  private journalFiles: Set<string> = new Set();
  private includeGraph: Map<string, Set<string>> = new Map(); // file → files it includes
  private reverseGraph: Map<string, Set<string>> = new Map(); // file → files that include it
  private rootFiles: Set<string> = new Set();
  private workspaceCache: Map<string, ParsedDocument> = new Map(); // root → parsed state

  // Configuration
  private config: Required<HledgerLspConfig> | null = null;
  private configPath: string | null = null;

  // Performance metrics
  private metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    totalParseTime: 0, // milliseconds
    parseCount: 0,
    initializationTime: 0
  };

  // Dependencies
  private parser!: HledgerParser;
  private fileReader!: FileReader;
  private connection!: Connection;

  /**
   * Initialize the WorkspaceManager with workspace folders and dependencies.
   * This discovers all journal files, builds the include graph, and identifies root files.
   * Optionally loads configuration from .hledger-lsp.json if present.
   */
  async initialize(
    workspaceFolders: string[],
    parser: HledgerParser,
    fileReader: FileReader,
    connection: Connection,
    runtimeConfig?: Partial<HledgerLspConfig>
  ): Promise<void> {
    const startTime = Date.now();

    this.workspaceFolders = workspaceFolders;
    this.parser = parser;
    this.fileReader = fileReader;
    this.connection = connection;

    // Try to discover and load config file
    await this.loadConfig(runtimeConfig);

    // Discover all journal files in workspace
    for (const folder of workspaceFolders) {
      const files = await this.discoverJournalFiles(folder);
      for (const file of files) {
        this.journalFiles.add(file);
      }
    }

    connection.console.log(`Discovered ${this.journalFiles.size} journal files in workspace`);

    // Warn if workspace is very large
    if (this.journalFiles.size > 100) {
      connection.console.warn(
        `Large workspace detected (${this.journalFiles.size} files). ` +
        `Consider using exclude patterns in .hledger-lsp.json to improve performance.`
      );
    }

    // Build include graph
    await this.buildIncludeGraph();

    // Identify root files (auto-detect + explicit from config)
    this.identifyRootFiles();

    const endTime = Date.now();
    this.metrics.initializationTime = endTime - startTime;

    connection.console.log(
      `Identified ${this.rootFiles.size} root files (initialized in ${this.metrics.initializationTime}ms)`
    );

    // Warn if initialization was slow
    if (this.metrics.initializationTime > 5000) {
      connection.console.warn(
        `Workspace initialization took ${this.metrics.initializationTime}ms. ` +
        `Consider optimizing your workspace structure or using exclude patterns.`
      );
    }
  }

  /**
   * Discover and load configuration from .hledger-lsp.json
   */
  private async loadConfig(runtimeConfig?: Partial<HledgerLspConfig>): Promise<void> {
    if (this.workspaceFolders.length === 0) {
      return;
    }

    // Try to find config file starting from first workspace folder
    const workspaceRoot = this.workspaceFolders[0];
    this.configPath = discoverConfigFile(workspaceRoot, workspaceRoot);

    if (this.configPath) {
      try {
        const loadResult = loadConfigFile(this.configPath);

        // Log any warnings
        if (loadResult.warnings.length > 0) {
          this.connection.console.warn(
            `Warnings in ${this.configPath}:\n${loadResult.warnings.join('\n')}`
          );
        }

        // Merge with runtime config (runtime takes precedence)
        this.config = mergeConfig(loadResult.config, runtimeConfig);

        this.connection.console.log(
          `Loaded configuration from ${this.configPath}`
        );
      } catch (error) {
        this.connection.console.error(
          `Failed to load config file ${this.configPath}: ${error}`
        );
        // Continue without config
      }
    }

    // If no config file, just use runtime config with defaults
    if (!this.config) {
      this.config = mergeConfig({}, runtimeConfig);
    }
  }

  /**
   * Discover all .journal and .hledger files in a workspace folder.
   * Uses fast-glob to find files, using patterns from config.
   */
  private async discoverJournalFiles(folder: string): Promise<string[]> {
    const folderPath = toFilePath(folder);

    // Use patterns from config, or defaults
    const patterns = this.config?.include ?? ['**/*.journal', '**/*.hledger'];
    const ignore = this.config?.exclude ?? ['**/node_modules/**', '**/.git/**', '**/.*'];

    try {
      const entries = await fg(patterns, {
        cwd: folderPath,
        onlyFiles: true,
        absolute: true,
        dot: false,
        ignore
      });

      // Convert to file:// URIs
      const uris = entries.map(p => toFileUri(p));
      uris.sort();

      return uris;
    } catch (error) {
      this.connection.console.error(`Error discovering journal files in ${folder}: ${error}`);
      return [];
    }
  }

  /**
   * Build the include graph by parsing each discovered file for include directives.
   * This creates both forward (file → includes) and reverse (file → included by) mappings.
   */
  private async buildIncludeGraph(): Promise<void> {
    for (const fileUri of this.journalFiles) {
      const doc = this.fileReader(fileUri);
      if (!doc) continue;

      // Parse the document to extract directives
      // We do a lightweight parse here - just need directives, not full parsing
      const parsed = this.parser.parse(doc, {
        baseUri: fileUri,
        fileReader: this.fileReader
      });

      // Extract include directives
      const includeDirectives = parsed.directives.filter(
        (d: Directive) => d.type === 'include'
      );

      // Resolve include paths and build graph
      const includes = new Set<string>();

      for (const directive of includeDirectives) {
        // Use the same include resolution logic as the parser
        // resolveIncludePaths is already used by the parser via IncludeManager
        const includePath = directive.value;

        // Simple resolution for now - we'll leverage the parser's resolution
        // For graph building, we need to determine which files this one includes
        // The parser already does this work in IncludeManager.processIncludes

        // Instead of duplicating resolution logic, we can use the parsed document
        // which already has all included files merged in
        // We'll track which files were actually included by looking at sourceUri

        // For now, we'll note that this file has include directives
        // The actual graph will be built from the parsed results
      }

      // Build graph from the parsed document's source URIs
      // Collect all unique sourceUris from the parsed document
      const includedFiles = new Set<string>();

      // Check accounts
      for (const [_, account] of parsed.accounts) {
        if (account.sourceUri && account.sourceUri !== fileUri) {
          includedFiles.add(account.sourceUri);
        }
      }

      // Check transactions
      for (const transaction of parsed.transactions) {
        if (transaction.sourceUri && transaction.sourceUri !== fileUri) {
          includedFiles.add(transaction.sourceUri);
        }
      }

      // Check directives
      for (const directive of parsed.directives) {
        if (directive.sourceUri && directive.sourceUri !== fileUri) {
          includedFiles.add(directive.sourceUri);
        }
      }

      // Update include graph
      this.includeGraph.set(fileUri, includedFiles);

      if (includedFiles.size > 0) {
        this.connection.console.log(`[WorkspaceManager] ${fileUri} includes ${includedFiles.size} file(s): ${Array.from(includedFiles).join(', ')}`);
      }

      // Update reverse graph
      for (const includedFile of includedFiles) {
        let parents = this.reverseGraph.get(includedFile);
        if (!parents) {
          parents = new Set();
          this.reverseGraph.set(includedFile, parents);
        }
        parents.add(fileUri);
      }
    }
  }

  /**
   * Identify root files using the following algorithm:
   * 0. Add explicitly configured root files from config
   * 1. If autoDetectRoots is enabled:
   *    a. Files with NO parent (not included by anyone) are roots
   *    b. Files that include many others (>3) are also roots
   *    c. If no roots found, treat each top-level file as root
   */
  private identifyRootFiles(): void {
    this.rootFiles.clear();

    // Step 0: Add explicit root files from config
    if (this.config && this.config.rootFiles.length > 0 && this.configPath) {
      const configDir = path.dirname(this.configPath);
      const explicitRoots = resolveRootFiles(this.config, configDir);

      for (const rootUri of explicitRoots) {
        // Verify the file exists and is in our discovered files
        if (this.journalFiles.has(rootUri)) {
          this.rootFiles.add(rootUri);
          this.connection.console.log(`[WorkspaceManager] Root from config: ${rootUri}`);
        } else {
          this.connection.console.warn(
            `[WorkspaceManager] Configured root file not found: ${rootUri}`
          );
        }
      }
    }

    // Step 1: Auto-detect roots (if enabled)
    const shouldAutoDetect = this.config?.workspace?.autoDetectRoots ?? true;

    if (shouldAutoDetect) {
      // Algorithm 1: Find files with no parents
      for (const fileUri of this.journalFiles) {
        const parents = this.reverseGraph.get(fileUri);
        if (!parents || parents.size === 0) {
          this.rootFiles.add(fileUri);
          this.connection.console.log(`[WorkspaceManager] Root identified (no parents): ${fileUri}`);
        } else {
          this.connection.console.log(`[WorkspaceManager] File has ${parents.size} parent(s): ${fileUri}`);
        }
      }

      // Algorithm 2: Find files that include many others (heuristic)
      const INCLUDE_THRESHOLD = 3;
      for (const [fileUri, includes] of this.includeGraph) {
        if (includes.size >= INCLUDE_THRESHOLD) {
          this.rootFiles.add(fileUri);
          this.connection.console.log(`[WorkspaceManager] Root identified (many includes): ${fileUri}`);
        }
      }

      // Algorithm 3: If no roots found, treat all files as roots
      if (this.rootFiles.size === 0) {
        this.connection.console.warn(
          'No root files detected, treating all journal files as roots'
        );
        for (const fileUri of this.journalFiles) {
          this.rootFiles.add(fileUri);
        }
      }
    } else if (this.rootFiles.size === 0) {
      // Auto-detect disabled and no explicit roots configured
      this.connection.console.warn(
        'Auto-detect disabled and no root files configured, treating all journal files as roots'
      );
      for (const fileUri of this.journalFiles) {
        this.rootFiles.add(fileUri);
      }
    }
  }

  /**
   * Get the root file for a given file URI.
   * Returns the root file that includes (transitively) this file.
   *
   * Algorithm:
   * 1. If the file IS a root, return itself
   * 2. Walk up the reverse graph to find roots that include this file
   * 3. If multiple roots, prefer one from the same workspace folder
   * 4. If no root found, return null (triggers fallback)
   */
  getRootForFile(uri: string): string | null {
    // If workspace hasn't finished initializing yet, return null
    // This prevents features from trying to use workspace mode before it's ready
    if (this.rootFiles.size === 0) {
      return null;
    }

    // If this file is a root, return it
    if (this.rootFiles.has(uri)) {
      return uri;
    }

    // Find all roots that transitively include this file
    const candidateRoots = new Set<string>();

    for (const root of this.rootFiles) {
      if (this.rootIncludesFile(root, uri)) {
        candidateRoots.add(root);
      }
    }

    if (candidateRoots.size === 0) {
      return null;
    }

    if (candidateRoots.size === 1) {
      return Array.from(candidateRoots)[0];
    }

    // Multiple roots - prefer one from same workspace folder
    const fileFolder = this.getWorkspaceFolder(uri);

    for (const root of candidateRoots) {
      const rootFolder = this.getWorkspaceFolder(root);
      if (fileFolder === rootFolder) {
        return root;
      }
    }

    // If no same-folder root, return first alphabetically
    const sorted = Array.from(candidateRoots).sort();
    return sorted[0];
  }

  /**
   * Check if a root file transitively includes a target file.
   * Uses BFS to traverse the include graph.
   */
  private rootIncludesFile(root: string, target: string): boolean {
    if (root === target) return true;

    const visited = new Set<string>();
    const queue: string[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      if (current === target) return true;

      const includes = this.includeGraph.get(current);
      if (includes) {
        for (const included of includes) {
          if (!visited.has(included)) {
            queue.push(included);
          }
        }
      }
    }

    return false;
  }

  /**
   * Get the workspace folder that contains the given URI.
   * Returns null if the file is outside all workspace folders.
   *
   * Edge case handling: Files outside workspace folders will return null,
   * which triggers a fallback to document-mode parsing. This is intentional
   * and allows the LSP to work with files opened outside the workspace.
   */
  private getWorkspaceFolder(uri: string): string | null {
    const filePath = toFilePath(uri);

    for (const folder of this.workspaceFolders) {
      const folderPath = toFilePath(folder);
      if (filePath.startsWith(folderPath)) {
        return folder;
      }
    }

    // File is outside all workspace folders
    this.connection.console.log(
      `[WorkspaceManager] File outside workspace folders: ${uri}`
    );
    return null;
  }

  /**
   * Parse the workspace from a root file URI.
   * Returns a cached ParsedDocument if available, otherwise parses and caches.
   */
  parseWorkspace(rootUri: string, force: boolean = false): ParsedDocument {
    // Check cache unless force is true
    if (!force) {
      const cached = this.workspaceCache.get(rootUri);
      if (cached) {
        this.metrics.cacheHits++;
        return cached;
      }
    }

    // Cache miss - need to parse
    this.metrics.cacheMisses++;
    const parseStartTime = Date.now();

    // Parse from root
    const rootDoc = this.fileReader(rootUri);
    if (!rootDoc) {
      throw new Error(`Root file not found: ${rootUri}`);
    }

    const parsed = this.parser.parse(rootDoc, {
      baseUri: rootUri,
      fileReader: this.fileReader
    });

    const parseEndTime = Date.now();
    const parseTime = parseEndTime - parseStartTime;
    this.metrics.totalParseTime += parseTime;
    this.metrics.parseCount++;

    // Log slow parses
    if (parseTime > 1000) {
      this.connection.console.warn(
        `Slow parse detected: ${rootUri} took ${parseTime}ms`
      );
    }

    // Cache the result
    this.workspaceCache.set(rootUri, parsed);

    return parsed;
  }

  /**
   * Invalidate the cache for a file.
   * Clears the workspace cache for all roots that transitively include this file.
   */
  invalidateFile(uri: string): void {
    // Find all roots that include this file
    const affectedRoots = new Set<string>();

    for (const root of this.rootFiles) {
      if (this.rootIncludesFile(root, uri)) {
        affectedRoots.add(root);
      }
    }

    // Clear cache for affected roots
    for (const root of affectedRoots) {
      this.workspaceCache.delete(root);
    }

    // Also clear the parser's include cache
    this.parser.clearCache(uri);
  }

  /**
   * Get diagnostic information about the workspace.
   * Useful for troubleshooting and performance monitoring.
   */
  getDiagnosticInfo(): {
    totalFiles: number;
    rootFiles: number;
    cacheSize: number;
    configFile: string | null;
    performance: {
      initializationTime: number;
      cacheHits: number;
      cacheMisses: number;
      cacheHitRate: string;
      averageParseTime: number;
      totalParseTime: number;
      parseCount: number;
    };
  } {
    const totalAccesses = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = totalAccesses > 0
      ? ((this.metrics.cacheHits / totalAccesses) * 100).toFixed(1) + '%'
      : 'N/A';
    const avgParseTime = this.metrics.parseCount > 0
      ? Math.round(this.metrics.totalParseTime / this.metrics.parseCount)
      : 0;

    return {
      totalFiles: this.journalFiles.size,
      rootFiles: this.rootFiles.size,
      cacheSize: this.workspaceCache.size,
      configFile: this.configPath,
      performance: {
        initializationTime: this.metrics.initializationTime,
        cacheHits: this.metrics.cacheHits,
        cacheMisses: this.metrics.cacheMisses,
        cacheHitRate,
        averageParseTime: avgParseTime,
        totalParseTime: this.metrics.totalParseTime,
        parseCount: this.metrics.parseCount
      }
    };
  }

  /**
   * Log diagnostic information to the console.
   * Useful for debugging and performance analysis.
   */
  logDiagnostics(): void {
    const info = this.getDiagnosticInfo();
    this.connection.console.log('=== WorkspaceManager Diagnostics ===');
    this.connection.console.log(`Files: ${info.totalFiles} total, ${info.rootFiles} roots`);
    this.connection.console.log(`Cache: ${info.cacheSize} entries`);
    this.connection.console.log(`Config: ${info.configFile || 'none'}`);
    this.connection.console.log('Performance:');
    this.connection.console.log(`  Initialization: ${info.performance.initializationTime}ms`);
    this.connection.console.log(`  Cache hits: ${info.performance.cacheHits}`);
    this.connection.console.log(`  Cache misses: ${info.performance.cacheMisses}`);
    this.connection.console.log(`  Cache hit rate: ${info.performance.cacheHitRate}`);
    this.connection.console.log(`  Parses: ${info.performance.parseCount} (avg ${info.performance.averageParseTime}ms)`);
    this.connection.console.log(`  Total parse time: ${info.performance.totalParseTime}ms`);
    this.connection.console.log('===================================');
  }
}
