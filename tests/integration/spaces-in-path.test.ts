/**
 * Integration test for handling file paths with spaces
 * This test simulates the real-world scenario where files are in directories
 * with spaces in their names (like "Google Drive", "Joint Finances (2025)", etc.)
 */

import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { validator } from '../../src/features/validator';
import { toFileUri, toFilePath, resolveIncludePath, defaultFileReader } from '../../src/utils/uri';
import { WorkspaceManager } from '../../src/server/workspace';
import { createMockConnection } from '../helpers/workspaceTestHelper';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('File paths with spaces integration test', () => {
  let tempDir: string;
  let mainFilePath: string;
  let declarationsFilePath: string;
  const isWindows = process.platform === 'win32';
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  // Helper to normalize paths for comparison on Windows (case-insensitive drive letters)
  const normalizePath = (p: string): string => {
    if (!isWindows) return p;
    // Convert drive letter to lowercase for consistent comparison
    return p.replace(/^([A-Z]):/, (_match, letter) => letter.toLowerCase() + ':');
  };

  beforeAll(() => {
    // Create a temporary directory structure that mimics a common setup with spaces in paths
    // We'll use actual filesystem to ensure everything works end-to-end
    const tmpBase = os.tmpdir();
    tempDir = path.join(tmpBase, 'hledger-test-spaces-' + Date.now());

    // Create structure similar to: Cloud Storage/My Documents (2025)/Reports/Week44/User/
    const deepDir = path.join(tempDir, 'Cloud Storage', 'My Documents (2025)', 'Reports', 'Week44', 'User');
    const ledgersDir = path.join(tempDir, 'Cloud Storage', 'My Documents (2025)', 'Ledgers');

    fs.mkdirSync(deepDir, { recursive: true });
    fs.mkdirSync(ledgersDir, { recursive: true });

    mainFilePath = path.join(deepDir, 'work.journal');
    declarationsFilePath = path.join(ledgersDir, 'declarations.journal');

    // Create main file with include directive
    fs.writeFileSync(mainFilePath, 'include ../../../Ledgers/declarations.journal\n\n2025-11-14 Test Transaction\n    Assets:Cash    $100\n    Income:Salary\n');

    // Create declarations file
    fs.writeFileSync(declarationsFilePath, 'account Assets:Cash\naccount Income:Salary\npayee Test Transaction\ncommodity $\n');
  });

  afterAll(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('URI encoding/decoding with spaces', () => {
    if (isWindows) return;
    // Test that we can convert paths with spaces to URIs and back
    const pathWithSpaces = '/home/user/Cloud Storage/test.journal';
    const uri = toFileUri(pathWithSpaces);
    const decodedPath = toFilePath(uri);

    expect(uri.toString()).toBe('file:///home/user/Cloud%20Storage/test.journal');
    expect(decodedPath).toBe(pathWithSpaces);
  });

  test('should parse file with spaces in path and resolve includes', async () => {
    // Create URI from the main file path
    const mainFileUri = toFileUri(mainFilePath);

    // Verify the URI has encoded spaces
    expect(mainFileUri.toString()).toContain('Cloud%20Storage');
    expect(mainFileUri.toString()).toContain('My%20Documents%20%282025%29');

    // Use WorkspaceManager to handle include resolution
    const workspaceManager = new WorkspaceManager();
    const connection = createMockConnection();
    await workspaceManager.initialize(
      [URI.file(tempDir)],
      parser,
      defaultFileReader,
      connection as any
    );

    // Parse via workspace manager to get includes resolved
    const parsed = workspaceManager.parseFromFile(mainFileUri);

    // Verify the include was processed
    // The directives array contains both the include directive and all directives from the included file
    expect(parsed.directives.length).toBeGreaterThan(1);
    const includeDirective = parsed.directives.find(d => d.type === 'include');
    expect(includeDirective).toBeDefined();
    expect(includeDirective?.value).toBe('../../../Ledgers/declarations.journal');

    // Verify that accounts from the included file are present
    const accountNames = Array.from(parsed.accounts.values()).map(a => a.name);
    expect(accountNames).toContain('Assets:Cash');
    expect(accountNames).toContain('Income:Salary');

    // Verify that declared items are marked as declared
    const assetsCash = parsed.accounts.get('Assets:Cash');
    expect(assetsCash?.declared).toBe(true);
  });

  test('should validate file with spaces in path without errors', async () => {
    const mainFileUri = URI.file(mainFilePath);
    const content = fs.readFileSync(mainFilePath, 'utf-8');
    const document = TextDocument.create(mainFileUri.toString(), 'hledger', 1, content);

    // Use WorkspaceManager to handle include resolution
    const workspaceManager = new WorkspaceManager();
    const connection = createMockConnection();
    await workspaceManager.initialize(
      [URI.file(tempDir)],
      parser,
      defaultFileReader,
      connection as any
    );

    // Parse with includes via workspace manager
    const parsed = workspaceManager.parseFromFile(mainFileUri);

    // Validate
    const result = validator.validate(document, parsed, {
      baseUri: mainFileUri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true,
          undeclaredAccounts: true,
          undeclaredPayees: true,
          undeclaredCommodities: true,
        }
      }
    });

    // Should have no errors because all items are declared in the included file
    const errors = result.diagnostics.filter(d => d.severity === 1); // Error severity
    expect(errors).toHaveLength(0);
  });

  test('should resolve include path correctly with spaces', () => {
    const mainFileUri = URI.file(mainFilePath);
    const includePath = '../../../Ledgers/declarations.journal';

    const resolvedUri = resolveIncludePath(includePath, mainFileUri);
    const resolvedPath = toFilePath(resolvedUri);

    // Verify the resolved path is correct
    expect(normalizePath(resolvedPath)).toBe(normalizePath(declarationsFilePath));

    // Verify the file exists
    expect(fs.existsSync(resolvedPath)).toBe(true);
  });

  test('should detect missing include file with spaces in path', () => {
    // Create a file that includes a non-existent file
    const testPath = path.join(tempDir, 'Cloud Storage', 'test-missing.journal');
    fs.writeFileSync(testPath, 'include missing-file.journal\n');

    const testUri = URI.file(testPath);
    const content = fs.readFileSync(testPath, 'utf-8');
    const document = TextDocument.create(testUri.toString(), 'hledger', 1, content);

    // Parse without fileReader (parser no longer resolves includes)
    const parsed = parser.parse(document);

    // Validate with fileReader so validator can check if include files exist
    const result = validator.validate(document, parsed, {
      baseUri: testUri,
      fileReader: defaultFileReader,
      settings: { validation: { includeFiles: true } }
    });

    // Should have an error about missing include file
    const includeErrors = result.diagnostics.filter(d => d.message.includes('Include file not found'));
    expect(includeErrors.length).toBeGreaterThan(0);
  });
});
