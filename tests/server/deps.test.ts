import { updateDependencies, clearDependencies, getDependents, getIncludes, __test_reset } from '../../src/server/deps';
import { URI } from 'vscode-uri';

describe('include dependency tracking', () => {
  beforeEach(() => {
    __test_reset();
  });

  test('updateDependencies registers reverse mappings', () => {
    const fileA = URI.parse('file:///a.journal');
    const fileB = URI.parse('file:///b.journal');
    const fileC = URI.parse('file:///c.journal');

    updateDependencies(fileA, new Set([fileB, fileC]));

    const dependentsB = getDependents(fileB);
    const dependentsC = getDependents(fileC);

    expect(dependentsB).toBeDefined();
    expect(dependentsC).toBeDefined();
    expect(dependentsB && dependentsB.has(fileA.toString())).toBe(true);
    expect(dependentsC && dependentsC.has(fileA.toString())).toBe(true);

    const includesA = getIncludes(fileA);
    expect(includesA).toBeDefined();
    expect(includesA && includesA.has(fileB.toString())).toBe(true);
    expect(includesA && includesA.has(fileC.toString())).toBe(true);
  });

  test('updateDependencies replaces old includes', () => {
    const fileA = URI.parse('file:///a.journal');
    const fileB = URI.parse('file:///b.journal');
    const fileC = URI.parse('file:///c.journal');

    updateDependencies(fileA, new Set([fileB]));
    updateDependencies(fileA, new Set([fileC]));

    const dependentsB = getDependents(fileB);
    const dependentsC = getDependents(fileC);

    expect(dependentsB && dependentsB.has(fileA.toString())).toBeFalsy();
    expect(dependentsC && dependentsC.has(fileA.toString())).toBe(true);
  });

  test('clearDependencies removes reverse mappings', () => {
    const fileA = URI.parse('file:///a.journal');
    const fileB = URI.parse('file:///b.journal');

    updateDependencies(fileA, new Set([fileB]));
    expect(getDependents(fileB)?.has(fileA.toString())).toBe(true);

    clearDependencies(fileA);

    expect(getDependents(fileB)?.has(fileA.toString())).toBeFalsy();
    expect(getIncludes(fileA)).toBeUndefined();
  });

  // These tests demonstrate that lookups must work with different URI.parse()
  // instances for the same URI string, matching the real usage in server.ts
  // where each call site creates a fresh URI via URI.parse().
  describe('URI identity: lookups with separately parsed URIs', () => {
    test('getDependents should find entries stored with a different URI.parse() instance', () => {
      // Simulates server.ts: updateDependencies(URI.parse(textDocument.uri), ...)
      // followed by: getDependents(URI.parse(change.document.uri))
      const uri = 'file:///home/user/ledger/main.journal';
      const includedUri = 'file:///home/user/ledger/expenses.journal';

      updateDependencies(URI.parse(uri), new Set([URI.parse(includedUri)]));

      // Look up with a fresh URI.parse() — different object instance, same URI string
      const dependents = getDependents(URI.parse(includedUri));
      expect(dependents).toBeDefined();
      expect(dependents!.size).toBeGreaterThan(0);
    });

    test('getIncludes should find entries stored with a different URI.parse() instance', () => {
      const uri = 'file:///home/user/ledger/main.journal';
      const includedUri = 'file:///home/user/ledger/expenses.journal';

      updateDependencies(URI.parse(uri), new Set([URI.parse(includedUri)]));

      // Look up with a fresh URI.parse() instance
      const includes = getIncludes(URI.parse(uri));
      expect(includes).toBeDefined();
      expect(includes!.size).toBe(1);
    });

    test('clearDependencies with a fresh URI.parse() should clear entries', () => {
      const uri = 'file:///home/user/ledger/main.journal';
      const includedUri = 'file:///home/user/ledger/expenses.journal';

      updateDependencies(URI.parse(uri), new Set([URI.parse(includedUri)]));

      // Clear with a fresh URI.parse() instance
      clearDependencies(URI.parse(uri));

      expect(getIncludes(URI.parse(uri))).toBeUndefined();
      expect(getDependents(URI.parse(includedUri))).toBeUndefined();
    });

    test('updateDependencies should replace old includes when called with fresh URI.parse()', () => {
      const uri = 'file:///home/user/ledger/main.journal';
      const fileB = 'file:///home/user/ledger/b.journal';
      const fileC = 'file:///home/user/ledger/c.journal';

      // First update with one set of includes
      updateDependencies(URI.parse(uri), new Set([URI.parse(fileB)]));

      // Second update with different includes, using fresh URI.parse()
      updateDependencies(URI.parse(uri), new Set([URI.parse(fileC)]));

      // fileB should no longer have main as a dependent
      const dependentsB = getDependents(URI.parse(fileB));
      expect(dependentsB?.size ?? 0).toBe(0);

      // fileC should have main as a dependent
      const dependentsC = getDependents(URI.parse(fileC));
      expect(dependentsC).toBeDefined();
      expect(dependentsC!.size).toBe(1);
    });
  });
});
