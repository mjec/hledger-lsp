import { Connection } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import fg from 'fast-glob';
import * as path from 'path';
import * as os from 'os';
import { HledgerParser } from '../parser/index';
import { ParsedDocument, Directive, FileReader } from '../types';
import { toFilePath, toFileUri } from '../utils/uri';
import { HledgerLspConfig, discoverConfigFile, loadConfigFile, resolveRootFile, mergeConfig } from './configFile';

export class WorkspaceManager {
  // Core state
  private workspaceFolders: URI[] = [];
  private journalFiles: Map<string, URI> = new Map();
  private includeGraph: Map<string, Map<string, URI>> = new Map(); // file → files it includes
  private reverseGraph: Map<string, Map<string, URI>> = new Map(); // file → files that include it
  private rootFile: URI | null = null;
  private workspaceCache: ParsedDocument | null = null; // single cached workspace state

  // Configuration
  private config: Required<HledgerLspConfig> | null = null;
  private configPath: URI | null = null;

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
    workspaceFolders: URI[],
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
        this.journalFiles.set(file.toString(), file);
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

    // Identify root file (auto-detect + explicit from config)
    this.identifyRootFile();

    const endTime = Date.now();
    this.metrics.initializationTime = endTime - startTime;

    connection.console.info(
      `[WorkspaceManager] Root file: ${this.rootFile || 'none'} (initialized in ${this.metrics.initializationTime}ms)`
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
    this.connection.console.debug(`Loading Config`)
    if (this.workspaceFolders.length === 0) {
      return;
    }

    // Try to find config file starting from first workspace folder
    const workspaceRoot = this.workspaceFolders[0];
    this.configPath = discoverConfigFile(workspaceRoot, workspaceRoot);
    this.connection.console.debug(`Conifg path is ${this.configPath}`)

    if (this.configPath) {
      try {
        const loadResult = loadConfigFile(this.configPath);
        this.connection.console.debug(`Loaded Config is ${JSON.stringify(loadResult.config)}`);

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

        this.connection.console.debug(`Config is ${JSON.stringify(this.config)}`);
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
  private async discoverJournalFiles(folder: URI): Promise<URI[]> {
    const folderPath = folder.fsPath;

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
   *
   * IMPORTANT: We parse WITHOUT following includes to get only DIRECT includes,
   * not transitive ones. This ensures the graph accurately represents the include structure.
   */
  private async buildIncludeGraph(): Promise<void> {

    for (const fileUri of this.journalFiles.values()) {
      const doc = this.fileReader(fileUri);
      if (!doc) continue;

      // Parse WITHOUT following includes - we only want direct include directives from this file
      const parsed = this.parser.parse(doc, {
        baseUri: fileUri,
        parseMode: 'document'

      });

      // Extract include directives from this file only
      const includeDirectives = parsed.directives.filter(
        (d: Directive) => d.type === 'include' && d.sourceUri?.toString() === fileUri.toString()
      );

      // Now resolve each include directive to get the actual file URIs
      const includedFiles = new Map<string, URI>();

      for (const directive of includeDirectives) {
        // The parser's include manager already resolved these paths
        // We can find which files were meant to be included by looking at
        // include directives that have the resolved path

        // Since we didn't follow includes, we need to resolve the paths ourselves
        // Get the include manager's resolution logic
        const includePath = directive.value;

        // Try to resolve this include path to a file URI
        // We'll check against our discovered journal files
        const baseDir = path.dirname(toFilePath(fileUri));

        // Handle different include path types
        let resolvedPaths: URI[] = [];

        if (includePath.includes('*') || includePath.includes('?')) {
          // Glob pattern - find matching files
          const pattern = path.isAbsolute(includePath)
            ? includePath
            : path.join(baseDir, includePath);

          try {
            const matches = fg.sync(pattern, {
              cwd: baseDir,
              absolute: true,
              onlyFiles: true
            });
            resolvedPaths = matches.map(p => toFileUri(p));
          } catch (err) {
            this.connection.console.warn(`[WorkspaceManager] Failed to resolve glob pattern ${includePath}: ${err}`);
          }
        } else {
          // Regular file path
          let resolvedPath: string;
          if (path.isAbsolute(includePath)) {
            resolvedPath = includePath;
          } else if (includePath.startsWith('~/')) {
            resolvedPath = path.join(os.homedir(), includePath.slice(2));
          } else {
            resolvedPath = path.join(baseDir, includePath);
          }

          const resolvedUri = toFileUri(resolvedPath);
          // Only add if it's in our discovered files
          if (this.journalFiles.has(resolvedUri.toString())) {
            resolvedPaths = [resolvedUri];
          }
        }

        // Add all resolved paths to included files
        for (const resolvedUri of resolvedPaths) {
          if (this.journalFiles.has(resolvedUri.toString())) {
            includedFiles.set(resolvedUri.toString(), resolvedUri);
          }
        }
      }

      // Update include graph
      this.includeGraph.set(fileUri.toString(), includedFiles);

      if (includedFiles.size > 0) {
        this.connection.console.debug(`[WorkspaceManager] ${fileUri} directly includes ${includedFiles.size} file(s): ${Array.from(includedFiles).join(', ')}`);
      }

      // Update reverse graph
      for (const includedFile of includedFiles) {
        let parents = this.reverseGraph.get(includedFile.toString());
        if (!parents) {
          parents = new Map<string, URI>();
          this.reverseGraph.set(includedFile.toString(), parents);
        }
        parents.set(fileUri.toString(), fileUri);
      }
    }
  }

  /**
   * Identify the single root file using the following algorithm:
   * 1. If explicitly configured in config, use that
   * 2. If autoDetectRoot is enabled, use heuristics to find the best root:
   *    a. Prefer files with NO parents (not included by anyone)
   *    b. Among those, prefer the one that includes the most files
   *    c. If multiple candidates, prefer one with "main" or "all" in the name
   *    d. If still tied, use alphabetically first
   * 3. If no suitable root found, return null (workspace features disabled)
   */
  private identifyRootFile(): void {
    this.rootFile = null;

    // Step 1: Check for explicit root file from config
    if (this.config && this.config.rootFile && this.configPath) {
      const explicitRoot = resolveRootFile(this.config, this.configPath);
      console.log(`[WorkspaceManager] Config path: ${this.configPath}`);
      console.log(`[WorkspaceManager] Explicit root from config: ${explicitRoot}`);
      console.log(`Journal files: ${Array.from(this.journalFiles).join(', ')}`);

      if (explicitRoot) {
        console.log(`Journal files has explicit root: ${this.journalFiles.has(explicitRoot.toString())}`);
        // Verify the file exists and is in our discovered files
        if (this.journalFiles.has(explicitRoot.toString())) {
          this.rootFile = explicitRoot;
          this.connection.console.log(`[WorkspaceManager] Using explicit root from config: ${explicitRoot}`);
          return;
        } else {
          this.connection.console.warn(
            `[WorkspaceManager] Configured root file not found: ${explicitRoot}`
          );
        }
      }
    }

    // Step 2: Auto-detect root (if enabled)
    const shouldAutoDetect = this.config?.workspace?.autoDetectRoot ?? true;

    if (!shouldAutoDetect) {
      this.connection.console.warn(
        '[WorkspaceManager] Auto-detect disabled and no valid root configured, workspace features disabled'
      );
      return;
    }

    // Find all files with no parents (not included by anyone)
    const candidateRoots: URI[] = [];
    for (const fileUri of this.journalFiles.values()) {
      const parents = this.reverseGraph.get(fileUri.toString());
      if (!parents || parents.size === 0) {
        candidateRoots.push(fileUri);
        this.connection.console.log(`[WorkspaceManager] Root candidate (no parents): ${fileUri}`);
      }
    }

    if (candidateRoots.length === 0) {
      this.connection.console.warn(
        '[WorkspaceManager] No root candidates found (all files are included by others), workspace features disabled'
      );
      return;
    }

    if (candidateRoots.length === 1) {
      this.rootFile = candidateRoots[0];
      this.connection.console.log(`[WorkspaceManager] Auto-detected root: ${this.rootFile}`);
      return;
    }

    // Multiple candidates - use heuristics to pick the best one
    this.connection.console.log(
      `[WorkspaceManager] Multiple root candidates (${candidateRoots.length}), using heuristics to select best`
    );

    // Score each candidate
    const scores = candidateRoots.map(root => {
      const includeCount = this.includeGraph.get(root.toString())?.size || 0;
      const basename = path.basename(toFilePath(root)).toLowerCase();
      const hasMainInName = basename.includes('main') || basename.includes('all') || basename.includes('index');

      return {
        root,
        includeCount,
        hasMainInName,
        basename
      };
    });

    // Sort by: 1) include count (desc), 2) has "main" in name, 3) alphabetically
    scores.sort((a, b) => {
      if (a.includeCount !== b.includeCount) {
        return b.includeCount - a.includeCount;
      }
      if (a.hasMainInName !== b.hasMainInName) {
        return a.hasMainInName ? -1 : 1;
      }
      return a.basename.localeCompare(b.basename);
    });

    this.rootFile = scores[0].root;
    this.connection.console.log(
      `[WorkspaceManager] Selected root: ${this.rootFile} (includes: ${scores[0].includeCount}, hasMain: ${scores[0].hasMainInName})`
    );
  }

  /**
   * Get the root file for a given file URI.
   * Returns the single root file if it transitively includes this file, or null otherwise.
   *
   * Algorithm:
   * 1. If no root file identified, return null
   * 2. If the root file transitively includes this file (or is the file itself), return the root
   * 3. Otherwise return null (file is not part of the workspace's include graph)
   */
  getRootForFile(uri: URI): URI | null {


    // If workspace hasn't finished initializing yet, return null
    if (!this.rootFile) {
      return null;
    }

    // Check if the root file transitively includes this file
    if (this.rootIncludesFile(this.rootFile, uri)) {
      return this.rootFile;
    }

    // File is not part of the workspace's include graph
    return null;
  }

  /**
   * Check if a root file transitively includes a target file.
   * Uses BFS to traverse the include graph.
   */
  private rootIncludesFile(root: URI, target: URI): boolean {
    if (root.toString() === target.toString()) return true;

    const visited = new Map<string, URI>();
    const queue: URI[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.toString())) continue;
      visited.set(current.toString(), current);

      if (current.toString() === target.toString()) return true;

      const includes = this.includeGraph.get(current.toString());
      if (includes) {
        for (const [includedString, included] of includes) {
          if (!visited.has(includedString)) {
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
  private getWorkspaceFolder(uri: URI): URI | null {
    // Normalize URI to ensure consistent matching
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
   * Parse the workspace from the root file.
   * Returns a cached ParsedDocument if available, otherwise parses and caches.
   */
  parseWorkspace(force: boolean = false): ParsedDocument | null {
    if (!this.rootFile) {
      this.connection.console.info('[WorkspaceManager] No root file - cannot parse workspace');
      return null;
    }

    // Check cache unless force is true
    if (!force && this.workspaceCache) {
      this.metrics.cacheHits++;
      return this.workspaceCache;
    }

    // Cache miss - need to parse
    this.metrics.cacheMisses++;
    const parseStartTime = Date.now();
    this.connection.console.info(`[WorkspaceManager] Parsing workspace from root: ${this.rootFile}`);

    // Parse from root
    const rootDoc = this.fileReader(this.rootFile);
    if (!rootDoc) {
      throw new Error(`Root file not found: ${this.rootFile}`);
    }

    const parsed = this.parser.parse(rootDoc, {
      baseUri: this.rootFile,
      fileReader: this.fileReader
    });

    const parseEndTime = Date.now();
    const parseTime = parseEndTime - parseStartTime;
    this.metrics.totalParseTime += parseTime;
    this.metrics.parseCount++;

    // Log parse completion
    this.connection.console.info(
      `[WorkspaceManager] Parsed workspace in ${parseTime}ms (${parsed.transactions.length} transactions, ${parsed.accounts.size} accounts)`
    );

    // Log slow parses
    if (parseTime > 1000) {
      this.connection.console.warn(
        `[WorkspaceManager] Slow parse detected: ${this.rootFile} took ${parseTime}ms`
      );
    }

    // Cache the result
    this.workspaceCache = parsed;

    return parsed;
  }

  /**
   * Invalidate the cache for a file.
   * Clears the workspace cache if the root file transitively includes this file.
   */
  invalidateFile(uri: URI): void {
    // If root file includes this file, clear the workspace cache
    if (this.rootFile && this.rootIncludesFile(this.rootFile, uri)) {
      this.connection.console.info(`[WorkspaceManager] Invalidating cache due to change in: ${uri}`);
      this.workspaceCache = null;
    } else {
      this.connection.console.info(`[WorkspaceManager] File change doesn't affect workspace cache: ${uri}`);
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
    rootFile: URI | null;
    cached: boolean;
    configFile: URI | null;
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
      rootFile: this.rootFile,
      cached: this.workspaceCache !== null,
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
    this.connection.console.log(`Files: ${info.totalFiles} total`);
    this.connection.console.log(`Root: ${info.rootFile || 'none'}`);
    this.connection.console.log(`Cache: ${info.cached ? 'populated' : 'empty'}`);
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
  /**
   * Generate a text-based tree representation of the workspace.
   */
  getWorkspaceTree(): string {
    if (!this.rootFile) {
      return 'No root file identified';
    }

    const lines: string[] = [];
    lines.push(path.basename(toFilePath(this.rootFile)));
    this.printTree(this.rootFile, '', lines, new Set([this.rootFile]));

    return lines.join('\n');
  }

  /**
   * Generate a structured representation of the workspace for better tooling integration.
   * Returns an array of entries with display text and absolute file paths.
   */
  getWorkspaceTreeStructured(): Array<{ display: string; path: string; uri: URI }> {
    if (!this.rootFile) {
      return [];
    }

    const entries: Array<{ display: string; path: string; uri: URI }> = [];
    const rootPath = toFilePath(this.rootFile);
    entries.push({
      display: path.basename(rootPath),
      path: rootPath,
      uri: this.rootFile
    });
    this.collectTreeEntries(this.rootFile, '', entries, new Set([this.rootFile]));

    return entries;
  }

  private collectTreeEntries(
    uri: URI,
    prefix: string,
    entries: Array<{ display: string; path: string; uri: URI }>,
    visited: Set<URI>
  ): void {
    const includes = this.includeGraph.get(uri.toString());
    if (!includes || includes.size === 0) return;

    const children = Array.from(includes).sort();
    const parentPath = toFilePath(uri);
    const parentDir = path.dirname(parentPath);

    for (let i = 0; i < children.length; i++) {
      const child = children[i][1];
      const isLast = i === children.length - 1;
      const marker = isLast ? '└── ' : '├── ';

      const childPath = toFilePath(child);
      const displayPath = path.relative(parentDir, childPath);

      entries.push({
        display: `${prefix}${marker}${displayPath}`,
        path: childPath,
        uri: child
      });

      if (!visited.has(child)) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        this.collectTreeEntries(child, newPrefix, entries, new Set([...visited, child]));
      } else {
        entries.push({
          display: `${prefix}${isLast ? '    ' : '│   '}└── (cycle)`,
          path: '',
          uri: URI.parse('')
        });
      }
    }
  }

  private printTree(uri: URI, prefix: string, lines: string[], visited: Set<URI>): void {
    const includes = this.includeGraph.get(uri.toString());
    if (!includes || includes.size === 0) return;

    const children = Array.from(includes).sort();
    const parentPath = toFilePath(uri);
    const parentDir = path.dirname(parentPath);

    for (let i = 0; i < children.length; i++) {
      const child = children[i][1];
      const isLast = i === children.length - 1;
      const marker = isLast ? '└── ' : '├── ';

      const childPath = toFilePath(child);
      let displayPath = path.relative(parentDir, childPath);

      // Ensure it looks like a file path
      if (!displayPath.startsWith('.') && !displayPath.startsWith('/')) {
        // It's in the same directory or a subdirectory, keep it as is
        // (path.relative returns just filename for same dir)
      }

      lines.push(`${prefix}${marker}${displayPath}`);

      if (!visited.has(child)) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        this.printTree(child, newPrefix, lines, new Set([...visited, child]));
      } else {
        lines.push(`${prefix}${isLast ? '    ' : '│   '}└── (cycle)`);
      }
    }
  }
}
