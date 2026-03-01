/**
 * Integration test for handling parentheses in workspace paths.
 *
 * Bug report: When the workspace folder contains parentheses (e.g.,
 * "Contabilidade (hledger)"), leaf files show undeclared accounts/payees.
 * Renaming the folder to remove parentheses fixes the issue.
 *
 * Root cause: fast-glob interprets parentheses as glob syntax when they
 * appear in the pattern string (as opposed to the cwd option). The
 * WorkspaceManager's defaultResolveIncludePaths joins the base directory
 * (containing parentheses) with the include glob pattern, creating a
 * pattern like "/path/Folder (name)/accounts/*.j" which fast-glob fails
 * to match.
 */

import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { validator } from '../../src/features/validator';
import { toFileUri, defaultFileReader } from '../../src/utils/uri';
import { WorkspaceManager } from '../../src/server/workspace';
import { createMockConnection } from '../helpers/workspaceTestHelper';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Parentheses in workspace path', () => {
  let tempDir: string;
  let workspaceDir: string;
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  beforeAll(() => {
    const tmpBase = os.tmpdir();
    tempDir = path.join(tmpBase, 'hledger-test-parens-' + Date.now());

    // Create workspace directory with parentheses in name — mirrors user's setup:
    // /home/user/Cloud/Documentos Partilhados/Finanças/Contabilidade (hledger)/
    workspaceDir = path.join(tempDir, 'Contabilidade (hledger)');

    const accountsDir = path.join(workspaceDir, 'accounts');
    const transactionsDir = path.join(workspaceDir, 'transactions', '2025');
    const extrasDir = path.join(workspaceDir, 'extras');

    fs.mkdirSync(accountsDir, { recursive: true });
    fs.mkdirSync(transactionsDir, { recursive: true });
    fs.mkdirSync(extrasDir, { recursive: true });

    // Create .hledger-lsp.json (mirrors user's config)
    fs.writeFileSync(
      path.join(workspaceDir, '.hledger-lsp.json'),
      JSON.stringify({
        rootFile: 'main.j',
        include: ['**/*.j', '**/*.journal', '**/*.hledger'],
        exclude: ['**/.git/**', '**/scripts/**', '**/temp/**'],
        workspace: {
          enabled: true,
          eagerParsing: true,
          autoDetectRoot: false,
        },
      })
    );

    // Create account declaration files
    fs.writeFileSync(
      path.join(accountsDir, 'assets.j'),
      'account Assets:Bank:Checking\naccount Assets:Cash\n'
    );
    fs.writeFileSync(
      path.join(accountsDir, 'expenses.j'),
      'account Expenses:Food\naccount Expenses:Transport\n'
    );
    fs.writeFileSync(
      path.join(accountsDir, 'income.j'),
      'account Income:Salary\n'
    );

    // Create extras
    fs.writeFileSync(
      path.join(extrasDir, 'payees.j'),
      'payee Grocery Store\npayee Employer\n'
    );

    // Create transaction file (leaf file — this is what the user opens)
    fs.writeFileSync(
      path.join(transactionsDir, 'checking.j'),
      [
        '2025-01-15 Grocery Store',
        '    Expenses:Food    $50.00',
        '    Assets:Bank:Checking',
        '',
        '2025-01-31 Employer',
        '    Assets:Bank:Checking    $3000.00',
        '    Income:Salary',
        '',
      ].join('\n')
    );
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('with non-glob includes', () => {
    beforeAll(() => {
      // main.j includes files individually (no glob patterns)
      fs.writeFileSync(
        path.join(workspaceDir, 'main.j'),
        [
          'include accounts/assets.j',
          'include accounts/expenses.j',
          'include accounts/income.j',
          'include extras/payees.j',
          'include transactions/2025/checking.j',
          '',
        ].join('\n')
      );
    });

    test('should discover config file in workspace with parentheses', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(workspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      // Config should have been loaded (root file identified)
      const rootForMain = workspaceManager.getRootForFile(
        toFileUri(path.join(workspaceDir, 'main.j'))
      );
      expect(rootForMain).not.toBeNull();
    });

    test('should identify root file from config', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(workspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      const mainUri = toFileUri(path.join(workspaceDir, 'main.j'));
      const rootForMain = workspaceManager.getRootForFile(mainUri);

      expect(rootForMain).not.toBeNull();
      expect(rootForMain!.toString()).toBe(mainUri.toString());
    });

    test('should resolve root for leaf files', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(workspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      const leafUri = toFileUri(path.join(workspaceDir, 'transactions', '2025', 'checking.j'));
      const root = workspaceManager.getRootForFile(leafUri);

      expect(root).not.toBeNull();
      expect(root!.fsPath).toContain('main.j');
    });

    test('should not report undeclared accounts in leaf files', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(workspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      const leafPath = path.join(workspaceDir, 'transactions', '2025', 'checking.j');
      const leafUri = URI.file(leafPath);
      const content = fs.readFileSync(leafPath, 'utf-8');
      const document = TextDocument.create(leafUri.toString(), 'hledger', 1, content);

      // Parse via workspace (as the server would)
      const parsed = workspaceManager.parseFromFile(leafUri);

      // Verify declarations from included files are visible
      expect(parsed.accounts.has('Assets:Bank:Checking')).toBe(true);
      expect(parsed.accounts.has('Expenses:Food')).toBe(true);
      expect(parsed.accounts.has('Income:Salary')).toBe(true);

      // Validate — should not report undeclared accounts
      const result = validator.validate(document, parsed, {
        baseUri: leafUri,
        fileReader: defaultFileReader,
        settings: {
          validation: {
            undeclaredAccounts: true,
            undeclaredPayees: true,
          },
        },
      });

      const undeclaredErrors = result.diagnostics.filter(
        (d) => d.message.includes('undeclared') || d.message.includes('Undeclared')
      );
      expect(undeclaredErrors).toHaveLength(0);
    });
  });

  describe('with glob includes', () => {
    beforeAll(() => {
      // main.j uses glob patterns to include files (common hledger pattern)
      fs.writeFileSync(
        path.join(workspaceDir, 'main.j'),
        [
          'include accounts/*.j',
          'include extras/*.j',
          'include transactions/2025/*.j',
          '',
        ].join('\n')
      );
    });

    test('should resolve root for leaf files with glob includes', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(workspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      const leafUri = toFileUri(path.join(workspaceDir, 'transactions', '2025', 'checking.j'));
      const root = workspaceManager.getRootForFile(leafUri);

      expect(root).not.toBeNull();
      expect(root!.fsPath).toContain('main.j');
    });

    test('should build complete include graph with glob includes', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(workspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      // All workspace files should be reachable from the root
      const allFiles = workspaceManager.getAllWorkspaceFiles();
      const filePaths = allFiles.map((u) => u.fsPath);

      // Use path.join for platform-appropriate separators (/ on Unix, \ on Windows)
      expect(filePaths).toContainEqual(
        expect.stringContaining(path.join('accounts', 'assets.j'))
      );
      expect(filePaths).toContainEqual(
        expect.stringContaining(path.join('accounts', 'expenses.j'))
      );
      expect(filePaths).toContainEqual(
        expect.stringContaining(path.join('accounts', 'income.j'))
      );
      expect(filePaths).toContainEqual(
        expect.stringContaining(path.join('extras', 'payees.j'))
      );
      expect(filePaths).toContainEqual(
        expect.stringContaining(path.join('transactions', '2025', 'checking.j'))
      );
    });

    test('should not report undeclared accounts with glob includes', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(workspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      const leafPath = path.join(workspaceDir, 'transactions', '2025', 'checking.j');
      const leafUri = URI.file(leafPath);
      const content = fs.readFileSync(leafPath, 'utf-8');
      const document = TextDocument.create(leafUri.toString(), 'hledger', 1, content);

      const parsed = workspaceManager.parseFromFile(leafUri);

      // Verify declarations from glob-included files are visible
      expect(parsed.accounts.has('Assets:Bank:Checking')).toBe(true);
      expect(parsed.accounts.has('Expenses:Food')).toBe(true);
      expect(parsed.accounts.has('Income:Salary')).toBe(true);

      const result = validator.validate(document, parsed, {
        baseUri: leafUri,
        fileReader: defaultFileReader,
        settings: {
          validation: {
            undeclaredAccounts: true,
            undeclaredPayees: true,
          },
        },
      });

      const undeclaredErrors = result.diagnostics.filter(
        (d) => d.message.includes('undeclared') || d.message.includes('Undeclared')
      );
      expect(undeclaredErrors).toHaveLength(0);
    });
  });

  describe('with non-ASCII and parentheses in path', () => {
    let deepWorkspaceDir: string;

    beforeAll(() => {
      // Reproduce the user's exact path pattern with accented characters + parentheses
      deepWorkspaceDir = path.join(
        tempDir,
        'Cloud',
        'Documentos Partilhados',
        'Finanças',
        'Contabilidade (hledger)'
      );

      const accountsDir = path.join(deepWorkspaceDir, 'accounts');
      const transDir = path.join(deepWorkspaceDir, 'transactions');

      fs.mkdirSync(accountsDir, { recursive: true });
      fs.mkdirSync(transDir, { recursive: true });

      fs.writeFileSync(
        path.join(deepWorkspaceDir, '.hledger-lsp.json'),
        JSON.stringify({
          rootFile: 'main.j',
          include: ['**/*.j'],
          exclude: ['**/.git/**'],
          workspace: { enabled: true, eagerParsing: true, autoDetectRoot: false },
        })
      );

      fs.writeFileSync(
        path.join(accountsDir, 'assets.j'),
        'account Assets:Bank\naccount Assets:Cash\n'
      );

      fs.writeFileSync(
        path.join(transDir, 'bank.j'),
        '2025-03-01 Test\n    Assets:Bank    $100\n    Assets:Cash\n'
      );

      // Use glob includes
      fs.writeFileSync(
        path.join(deepWorkspaceDir, 'main.j'),
        'include accounts/*.j\ninclude transactions/*.j\n'
      );
    });

    test('should work with accented characters and parentheses in path', async () => {
      const workspaceManager = new WorkspaceManager();
      const connection = createMockConnection();

      await workspaceManager.initialize(
        [URI.file(deepWorkspaceDir)],
        parser,
        defaultFileReader,
        connection as any
      );

      const leafUri = toFileUri(path.join(deepWorkspaceDir, 'transactions', 'bank.j'));
      const root = workspaceManager.getRootForFile(leafUri);

      expect(root).not.toBeNull();

      const parsed = workspaceManager.parseFromFile(leafUri);
      expect(parsed.accounts.has('Assets:Bank')).toBe(true);
      expect(parsed.accounts.has('Assets:Cash')).toBe(true);
    });
  });
});
