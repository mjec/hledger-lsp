/**
 * Test helper for creating WorkspaceManager instances for testing.
 * This replaces the old pattern of passing fileReader to the parser.
 */

import * as path from 'path';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceManager, IncludePathResolver } from '../../src/server/workspace';
import { HledgerParser } from '../../src/parser';
import { ParsedDocument } from '../../src/types';
import { toFileUri } from '../../src/utils/uri';

// Re-export IncludePathResolver for tests that need to create custom resolvers
export { IncludePathResolver } from '../../src/server/workspace';

/**
 * Creates a mock connection object for WorkspaceManager.
 * The console methods are no-ops by default.
 */
export function createMockConnection() {
  return {
    console: {
      log: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  } as any;
}

/**
 * Options for creating a test workspace.
 */
export interface TestWorkspaceOptions {
  /**
   * Map of file paths to document content.
   * Paths should be relative to a virtual base directory.
   */
  files: Map<string, string> | { [path: string]: string };

  /**
   * Base directory for the virtual workspace.
   * Defaults to '/test-workspace'
   */
  baseDir?: string;

  /**
   * Custom include path resolver for testing glob patterns and include behavior.
   * If not provided, a default resolver will be created that maps include paths
   * to files within the test workspace.
   */
  includePathResolver?: IncludePathResolver;
}

/**
 * Result of creating a test workspace.
 */
export interface TestWorkspace {
  /**
   * Parse from a specific file, returning the merged document
   * including all files reachable via includes.
   */
  parseFromFile: (relativePath: string) => ParsedDocument;

  /**
   * Parse the entire workspace from the auto-detected root.
   */
  parseWorkspace: () => ParsedDocument | null;

  /**
   * Get a TextDocument by relative path.
   */
  getDocument: (relativePath: string) => TextDocument | null;

  /**
   * Get the URI for a relative path.
   */
  getUri: (relativePath: string) => URI;

  /**
   * The underlying WorkspaceManager instance.
   */
  workspaceManager: WorkspaceManager;

  /**
   * The parser instance.
   */
  parser: HledgerParser;
}

/**
 * Creates a test workspace with the given files.
 * This sets up a WorkspaceManager that can parse files with include resolution.
 *
 * @example
 * ```typescript
 * const workspace = await createTestWorkspace({
 *   files: {
 *     'main.journal': 'include sub.journal\naccount Assets',
 *     'sub.journal': 'account Expenses'
 *   }
 * });
 *
 * const parsed = workspace.parseFromFile('main.journal');
 * // parsed contains accounts from both files
 * ```
 */
export async function createTestWorkspace(options: TestWorkspaceOptions): Promise<TestWorkspace> {
  const baseDir = options.baseDir || '/test-workspace';

  // Convert files to Map if needed
  const filesMap = options.files instanceof Map
    ? options.files
    : new Map(Object.entries(options.files));

  // Create TextDocuments and collect URIs
  const documents = new Map<string, TextDocument>();
  const uris = new Map<string, URI>();
  const fileUris: URI[] = [];

  for (const [relativePath, content] of filesMap) {
    const fullPath = `${baseDir}/${relativePath}`;
    const uri = URI.file(fullPath);
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    documents.set(relativePath, doc);
    uris.set(relativePath, uri);
    fileUris.push(uri);
  }

  // Create fileReader function
  const fileReader = (uri: URI): TextDocument | null => {
    for (const [, doc] of documents) {
      if (doc.uri === uri.toString()) {
        return doc;
      }
    }
    return null;
  };

  // Create default include path resolver if not provided
  // This resolver maps include paths to files within the test workspace
  const defaultResolver: IncludePathResolver = (includePath: string, baseUri: URI) => {
    // For test purposes, resolve paths relative to the base directory
    // This handles simple relative includes like "sub.journal" or "dir/file.journal"
    const result: URI[] = [];

    // Get the base path for the including file
    const baseFileDir = path.dirname(baseUri.fsPath);

    // Handle relative paths
    let resolvedPath: string;
    if (path.isAbsolute(includePath)) {
      resolvedPath = includePath;
    } else {
      resolvedPath = path.join(baseFileDir, includePath);
    }

    // Check if this matches any of our test files
    const resolvedUri = toFileUri(resolvedPath);
    const baseDirNormalized = path.normalize(baseDir);
    const relativePath = path.relative(baseDirNormalized, path.normalize(resolvedPath));
    if (documents.has(relativePath)) {
      result.push(resolvedUri);
    }

    return result;
  };

  const includeResolver = options.includePathResolver ?? defaultResolver;

  // Create parser and WorkspaceManager
  const parser = new HledgerParser();
  const connection = createMockConnection();
  const workspaceManager = new WorkspaceManager();

  // Initialize with the files directly (bypasses filesystem discovery)
  await workspaceManager.initializeWithFiles(fileUris, parser, fileReader, connection, includeResolver);

  return {
    parseFromFile: (relativePath: string): ParsedDocument => {
      const uri = uris.get(relativePath);
      if (!uri) {
        throw new Error(`File not found: ${relativePath}`);
      }
      return workspaceManager.parseFromFile(uri);
    },

    parseWorkspace: (): ParsedDocument | null => {
      return workspaceManager.parseWorkspace();
    },

    getDocument: (relativePath: string): TextDocument | null => {
      return documents.get(relativePath) || null;
    },

    getUri: (relativePath: string): URI => {
      const uri = uris.get(relativePath);
      if (!uri) {
        throw new Error(`File not found: ${relativePath}`);
      }
      return uri;
    },

    workspaceManager,
    parser,
  };
}

/**
 * Simple helper for parsing a single document without includes.
 * This is the equivalent of the old parser.parse(doc, { parseMode: 'document' }).
 */
export function parseDocumentOnly(content: string, uri?: string): ParsedDocument {
  const parser = new HledgerParser();
  const docUri = uri || 'file:///test.journal';
  const doc = TextDocument.create(docUri, 'hledger', 1, content);
  return parser.parse(doc);
}
