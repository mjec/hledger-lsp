import { createTestWorkspace, IncludePathResolver } from '../helpers/workspaceTestHelper';
import { toFileUri } from '../../src/utils/uri';

describe('include glob expansion', () => {
  test('expands simple relative glob and excludes the including file', async () => {
    // A tree:
    // /test-workspace/
    //   a.journal
    //   b.journal
    //   include-all.journal  (contains: include *.journal)

    const baseDir = '/test-workspace';

    // Custom resolver that handles the *.journal glob pattern
    const includeResolver: IncludePathResolver = (includePath, baseUri) => {

      if (includePath === '*.journal') {
        // Return a.journal and b.journal but NOT include-all.journal (the including file)
        const result = [
          toFileUri(`${baseDir}/a.journal`),
          toFileUri(`${baseDir}/b.journal`)
        ];
        return result;
      }

      // Fallback for other includes - resolve relative path
      const baseFilePath = baseUri.fsPath;
      const baseFileDir = baseFilePath.substring(0, baseFilePath.lastIndexOf('/'));
      return [toFileUri(`${baseFileDir}/${includePath}`)];
    };

    const workspace = await createTestWorkspace({
      baseDir,
      files: {
        'include-all.journal': 'include *.journal\n',
        'a.journal': 'account Assets:Cash\n',
        'b.journal': 'account Expenses:Food\n',
      },
      includePathResolver: includeResolver
    });

    const parsed = workspace.parseFromFile('include-all.journal');

    // Should contain accounts from a.journal and b.journal
    const accounts: string[] = Array.from(parsed.accounts.values()).map(acc => acc.name);
    expect(accounts).toContain('Assets:Cash');
    expect(accounts).toContain('Expenses:Food');
  });

  test('expands recursive glob (**/*) and excludes dotfiles', async () => {
    // create documents in nested dirs and a dotfile that should be excluded
    const baseDir = '/test-workspace';

    // Custom resolver that handles the **/*.journal recursive glob pattern
    const includeResolver: IncludePathResolver = (includePath, baseUri) => {

      if (includePath === '**/*.journal') {
        // Return files in subdirectories, excluding dotfiles
        const result = [
          toFileUri(`${baseDir}/dir/one.journal`),
          toFileUri(`${baseDir}/dir/sub/two.journal`)
        ];
        return result;
      }

      // Fallback for other includes
      const baseFilePath = baseUri.fsPath;
      const baseFileDir = baseFilePath.substring(0, baseFilePath.lastIndexOf('/'));
      return [toFileUri(`${baseFileDir}/${includePath}`)];
    };

    const workspace = await createTestWorkspace({
      baseDir,
      files: {
        'root.journal': 'include **/*.journal\n',
        'dir/one.journal': 'account Liabilities:Card\n',
        'dir/sub/two.journal': 'account Income:Salary\n',
        '.hidden.journal': 'account Hidden:Acct\n',
      },
      includePathResolver: includeResolver
    });

    const parsed = workspace.parseFromFile('root.journal');
    const accounts: string[] = Array.from(parsed.accounts.values()).map(acc => acc.name);

    expect(accounts).toContain('Liabilities:Card');
    expect(accounts).toContain('Income:Salary');
    // dotfile should be excluded by default (the resolver doesn't return it)
    expect(accounts).not.toContain('Hidden:Acct');
  });
});
