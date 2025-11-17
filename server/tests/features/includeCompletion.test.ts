/**
 * Tests for include path completion
 */

import { CompletionProvider } from '../../src/features/completion';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItemKind } from 'vscode-languageserver';
import * as path from 'path';
import * as fs from 'fs';

describe('Include Path Completion', () => {
  let provider: CompletionProvider;
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  const nestedPath = path.join(fixturesPath, 'nested');

  beforeEach(() => {
    provider = new CompletionProvider();
  });

  test('should complete files in current directory', () => {
    const doc = TextDocument.create(
      'file://' + path.join(nestedPath, 'test.journal'),
      'hledger',
      1,
      'include '
    );

    const position = { line: 0, character: 8 };
    const items = provider.getCompletionItems(doc, position);

    // Should find child.journal in nested directory
    expect(items.some(i => i.label === 'child.journal')).toBe(true);
  });

  test('should complete parent directory with ../', () => {
    const doc = TextDocument.create(
      'file://' + path.join(nestedPath, 'test.journal'),
      'hledger',
      1,
      'include ../'
    );

    const position = { line: 0, character: 11 };
    const items = provider.getCompletionItems(doc, position);

    // Should find parent.journal in parent directory
    expect(items.some(i => i.label === 'parent.journal')).toBe(true);

    // Should also show monthly/ directory
    expect(items.some(i => i.label === 'monthly/')).toBe(true);
  });

  test('should complete parent directory when typing just ..', () => {
    const doc = TextDocument.create(
      'file://' + path.join(nestedPath, 'test.journal'),
      'hledger',
      1,
      'include ..'
    );

    const position = { line: 0, character: 10 };
    const items = provider.getCompletionItems(doc, position);

    // This should show parent directory contents (currently buggy)
    // Should find parent.journal in parent directory
    expect(items.some(i => i.label === 'parent.journal')).toBe(true);

    // Should also show monthly/ directory
    expect(items.some(i => i.label === 'monthly/')).toBe(true);
  });

  test('should complete sibling directory with ../sibling/', () => {
    // Create sibling directory if it doesn't exist
    const siblingPath = path.join(fixturesPath, 'sibling');
    const createdSibling = !fs.existsSync(siblingPath);
    if (createdSibling) {
      fs.mkdirSync(siblingPath);
      fs.writeFileSync(path.join(siblingPath, 'sibling.journal'), '');
    }

    const doc = TextDocument.create(
      'file://' + path.join(nestedPath, 'test.journal'),
      'hledger',
      1,
      'include ../sibling/'
    );

    const position = { line: 0, character: 19 };
    const items = provider.getCompletionItems(doc, position);

    // Should find sibling.journal
    expect(items.some(i => i.label === 'sibling.journal')).toBe(true);

    // Cleanup
    if (createdSibling) {
      fs.unlinkSync(path.join(siblingPath, 'sibling.journal'));
      fs.rmdirSync(siblingPath);
    }
  });

  test('should complete subdirectory of parent with ../monthly/', () => {
    const doc = TextDocument.create(
      'file://' + path.join(nestedPath, 'test.journal'),
      'hledger',
      1,
      'include ../monthly/'
    );

    const position = { line: 0, character: 19 };
    const items = provider.getCompletionItems(doc, position);

    // Should find february.journal in monthly directory
    expect(items.some(i => i.label === 'february.journal')).toBe(true);
  });

  test('should show directories with trailing slash', () => {
    const doc = TextDocument.create(
      'file://' + path.join(nestedPath, 'test.journal'),
      'hledger',
      1,
      'include ../'
    );

    const position = { line: 0, character: 11 };
    const items = provider.getCompletionItems(doc, position);

    // Directories should have trailing slash
    const monthlyItem = items.find(i => i.label === 'monthly/');
    expect(monthlyItem).toBeDefined();
    expect(monthlyItem?.kind).toBe(CompletionItemKind.Folder);

    const nestedItem = items.find(i => i.label === 'nested/');
    expect(nestedItem).toBeDefined();
    expect(nestedItem?.kind).toBe(CompletionItemKind.Folder);
  });
});
