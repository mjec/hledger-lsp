import { CallHierarchyProvider } from '../../src/features/callHierarchy';
import { createTestWorkspace, IncludePathResolver } from '../helpers/workspaceTestHelper';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolKind } from 'vscode-languageserver/node';
import { toFileUri } from '../../src/utils/uri';
import { URI } from 'vscode-uri';

describe('CallHierarchyProvider', () => {
  let provider: CallHierarchyProvider;

  beforeEach(() => {
    provider = new CallHierarchyProvider();
  });

  describe('prepareCallHierarchy', () => {
    test('should return current file when not on include line', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include sub.journal\n\n2024-01-15 * Test\n    expenses:food  $50\n    assets:checking',
          'sub.journal': 'account expenses:food\naccount assets:checking',
        }
      });

      const doc = workspace.getDocument('main.journal')!;
      const parsed = workspace.parseFromFile('main.journal');
      const result = provider.prepareCallHierarchy(
        doc, 2, 0, parsed, workspace.workspaceManager
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].kind).toBe(SymbolKind.File);
      expect(result![0].name).toBe('main.journal');
    });

    test('should return included file when on include directive', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include sub.journal\n\n2024-01-15 * Test\n    expenses:food  $50\n    assets:checking',
          'sub.journal': 'account expenses:food',
        }
      });

      const doc = workspace.getDocument('main.journal')!;
      const parsed = workspace.parseFromFile('main.journal');
      const result = provider.prepareCallHierarchy(
        doc, 0, 10, parsed, workspace.workspaceManager
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].name).toBe('sub.journal');
    });

    test('should return null for file not in workspace', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'account expenses:food',
        }
      });

      // Create a document that's not in the workspace
      const unknownDoc = TextDocument.create('file:///unknown/file.journal', 'hledger', 1, 'account test');
      const parser = new HledgerParser();
      const parsed = parser.parse(unknownDoc);

      const result = provider.prepareCallHierarchy(
        unknownDoc, 0, 0, parsed, workspace.workspaceManager
      );

      expect(result).toBeNull();
    });
  });

  describe('resolveIncomingCalls', () => {
    test('should return parent files that include the target', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include sub.journal',
          'sub.journal': 'account expenses:food',
        }
      });

      const subUri = workspace.getUri('sub.journal');
      const item = {
        name: 'sub.journal',
        kind: SymbolKind.File,
        uri: subUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveIncomingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].from.name).toBe('main.journal');
      expect(result![0].fromRanges).toHaveLength(1);
      expect(result![0].fromRanges[0].start.line).toBe(0);
    });

    test('should return empty for root file (no parents)', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include sub.journal',
          'sub.journal': 'account expenses:food',
        }
      });

      const mainUri = workspace.getUri('main.journal');
      const item = {
        name: 'main.journal',
        kind: SymbolKind.File,
        uri: mainUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveIncomingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(0);
    });

    test('should return multiple callers when file included by several files', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include shared.journal',
          'other.journal': 'include shared.journal',
          'shared.journal': 'account expenses:food',
        }
      });

      const sharedUri = workspace.getUri('shared.journal');
      const item = {
        name: 'shared.journal',
        kind: SymbolKind.File,
        uri: sharedUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveIncomingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      const callerNames = result!.map(c => c.from.name).sort();
      expect(callerNames).toEqual(['main.journal', 'other.journal']);
    });

    test('should have fromRanges pointing to correct include directive lines', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'account expenses\ninclude sub.journal\naccount income',
          'sub.journal': 'account assets',
        }
      });

      const subUri = workspace.getUri('sub.journal');
      const item = {
        name: 'sub.journal',
        kind: SymbolKind.File,
        uri: subUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveIncomingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      // The include directive is on line 1 (0-indexed)
      expect(result![0].fromRanges[0].start.line).toBe(1);
      expect(result![0].fromRanges[0].start.character).toBe(8); // After "include "
    });
  });

  describe('resolveOutgoingCalls', () => {
    test('should return included files', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include sub.journal',
          'sub.journal': 'account expenses:food',
        }
      });

      const mainUri = workspace.getUri('main.journal');
      const item = {
        name: 'main.journal',
        kind: SymbolKind.File,
        uri: mainUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveOutgoingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].to.name).toBe('sub.journal');
      expect(result![0].fromRanges).toHaveLength(1);
      expect(result![0].fromRanges[0].start.line).toBe(0);
    });

    test('should return empty for leaf file', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include sub.journal',
          'sub.journal': 'account expenses:food',
        }
      });

      const subUri = workspace.getUri('sub.journal');
      const item = {
        name: 'sub.journal',
        kind: SymbolKind.File,
        uri: subUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveOutgoingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(0);
    });

    test('should handle multiple includes from one file', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'include expenses.journal\ninclude income.journal',
          'expenses.journal': 'account expenses:food',
          'income.journal': 'account income:salary',
        }
      });

      const mainUri = workspace.getUri('main.journal');
      const item = {
        name: 'main.journal',
        kind: SymbolKind.File,
        uri: mainUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveOutgoingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      const targetNames = result!.map(c => c.to.name).sort();
      expect(targetNames).toEqual(['expenses.journal', 'income.journal']);
    });

    test('should have fromRanges pointing to correct include directive lines', async () => {
      const workspace = await createTestWorkspace({
        files: {
          'main.journal': 'account root\ninclude expenses.journal\ninclude income.journal',
          'expenses.journal': 'account expenses:food',
          'income.journal': 'account income:salary',
        }
      });

      const mainUri = workspace.getUri('main.journal');
      const item = {
        name: 'main.journal',
        kind: SymbolKind.File,
        uri: mainUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveOutgoingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      // Find the expenses entry and income entry
      const expenses = result!.find(c => c.to.name === 'expenses.journal');
      const income = result!.find(c => c.to.name === 'income.journal');

      expect(expenses).toBeDefined();
      expect(expenses!.fromRanges[0].start.line).toBe(1); // Second line
      expect(expenses!.fromRanges[0].start.character).toBe(8); // After "include "

      expect(income).toBeDefined();
      expect(income!.fromRanges[0].start.line).toBe(2); // Third line
      expect(income!.fromRanges[0].start.character).toBe(8);
    });

    test('should handle glob includes resolving to multiple files', async () => {
      const baseDir = '/test-workspace';

      const includeResolver: IncludePathResolver = (includePath: string, baseUri: URI) => {
        if (includePath === '*.journal') {
          return [
            toFileUri(`${baseDir}/a.journal`),
            toFileUri(`${baseDir}/b.journal`),
          ];
        }
        // Default: resolve relative to base
        const baseFileDir = baseUri.fsPath.substring(0, baseUri.fsPath.lastIndexOf('/'));
        return [toFileUri(`${baseFileDir}/${includePath}`)];
      };

      const workspace = await createTestWorkspace({
        baseDir,
        files: {
          'main.journal': 'include *.journal',
          'a.journal': 'account expenses:a',
          'b.journal': 'account expenses:b',
        },
        includePathResolver: includeResolver,
      });

      const mainUri = workspace.getUri('main.journal');
      const item = {
        name: 'main.journal',
        kind: SymbolKind.File,
        uri: mainUri.toString(),
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };

      const fileReader = (uri: URI) => workspace.getDocument(
        uri.toString().replace('file:///test-workspace/', '')
      );

      const result = provider.resolveOutgoingCalls(
        item, workspace.workspaceManager, fileReader
      );

      expect(result).not.toBeNull();
      expect(result!.length).toBe(2);

      const targetNames = result!.map(c => c.to.name).sort();
      expect(targetNames).toEqual(['a.journal', 'b.journal']);

      // Both should have fromRanges pointing to line 0 (the glob include line)
      for (const call of result!) {
        expect(call.fromRanges[0].start.line).toBe(0);
      }
    });
  });
});
