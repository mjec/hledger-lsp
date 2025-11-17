import { TextDocument } from 'vscode-languageserver-textdocument';

// Mock resolveIncludePaths so tests don't access the real filesystem. This must run
// before importing the parser which imports the utils module.
jest.mock('../../src/utils/uri', () => {
  const real = jest.requireActual('../../src/utils/uri');
  const baseDir = '/tmp/hledger-lsp-test';
  return {
    ...real,
    resolveIncludePaths: (includePath: string, baseUri: string) => {
      // Simple deterministic mapping for our test cases
      if (includePath === '*.journal') {
        return [real.toFileUri(`${baseDir}/a.journal`), real.toFileUri(`${baseDir}/b.journal`)];
      }
      if (includePath === '**/*.journal') {
        return [real.toFileUri(`${baseDir}/dir/one.journal`), real.toFileUri(`${baseDir}/dir/sub/two.journal`)];
      }
      // Fallback to the single-path resolver
      return [real.resolveIncludePath(includePath, baseUri)];
    }
  };
});

import { parser as sharedParser } from '../../src/parser';
import { toFileUri } from '../../src/utils/uri';

describe('include glob expansion', () => {
  const baseDir = '/tmp/hledger-lsp-test';

  // helper to create a TextDocument with given content and uri
  function docFor(path: string, content: string) {
    const uri = toFileUri(`${baseDir}/${path}`);
    return TextDocument.create(uri, 'journal', 0, content);
  }

  test('expands simple relative glob and excludes the including file', () => {
    // A tree:
    // /tmp/hledger-lsp-test/
    //   a.journal
    //   b.journal
    //   include-all.journal  (contains: include *.journal)

    const includeAll = docFor('include-all.journal', 'include *.journal\n');
    const a = docFor('a.journal', 'account Assets:Cash\n');
    const b = docFor('b.journal', 'account Expenses:Food\n');

    // Provide a fileReader that maps these URIs to the documents above
    const fileReader = (uri: string) => {
      if (uri === includeAll.uri) return includeAll;
      if (uri === a.uri) return a;
      if (uri === b.uri) return b;
      return null;
    };

    const parsed = sharedParser.parse(includeAll, { baseUri: includeAll.uri, fileReader });

    // Should contain accounts from a.journal and b.journal, but not re-include include-all.journal
    const accounts: string[] = parsed.accounts.map(acc => acc.name);
    expect(accounts).toContain('Assets:Cash');
    expect(accounts).toContain('Expenses:Food');
  });

  test('expands recursive glob (**/*) and excludes dotfiles', () => {
    // create documents in nested dirs and a dotfile that should be excluded
    const rootInclude = docFor('root.journal', 'include **/*.journal\n');
    const sub = docFor('dir/one.journal', 'account Liabilities:Card\n');
    const sub2 = docFor('dir/sub/two.journal', 'account Income:Salary\n');
    const dot = docFor('.hidden.journal', 'account Hidden:Acct\n');

    const fileReader = (uri: string) => {
      switch (uri) {
        case rootInclude.uri:
          return rootInclude;
        case sub.uri:
          return sub;
        case sub2.uri:
          return sub2;
        case dot.uri:
          return dot;
        default:
          return null;
      }
    };

    const parsed = sharedParser.parse(rootInclude, { baseUri: rootInclude.uri, fileReader });
    const accounts: string[] = parsed.accounts.map(acc => acc.name);

    expect(accounts).toContain('Liabilities:Card');
    expect(accounts).toContain('Income:Salary');
    // dotfile should be excluded by default
    expect(accounts).not.toContain('Hidden:Acct');
  });
});
