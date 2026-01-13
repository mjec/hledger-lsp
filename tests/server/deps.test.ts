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
    expect(dependentsB && dependentsB.has(fileA)).toBe(true);
    expect(dependentsC && dependentsC.has(fileA)).toBe(true);

    const includesA = getIncludes(fileA);
    expect(includesA).toBeDefined();
    expect(includesA && includesA.has(fileB)).toBe(true);
    expect(includesA && includesA.has(fileC)).toBe(true);
  });

  test('updateDependencies replaces old includes', () => {
    const fileA = URI.parse('file:///a.journal');
    const fileB = URI.parse('file:///b.journal');
    const fileC = URI.parse('file:///c.journal');

    updateDependencies(fileA, new Set([fileB]));
    updateDependencies(fileA, new Set([fileC]));

    const dependentsB = getDependents(fileB);
    const dependentsC = getDependents(fileC);

    expect(dependentsB && dependentsB.has(fileA)).toBeFalsy();
    expect(dependentsC && dependentsC.has(fileA)).toBe(true);
  });

  test('clearDependencies removes reverse mappings', () => {
    const fileA = URI.parse('file:///a.journal');
    const fileB = URI.parse('file:///b.journal');

    updateDependencies(fileA, new Set([fileB]));
    expect(getDependents(fileB)?.has(fileA)).toBe(true);

    clearDependencies(fileA);

    expect(getDependents(fileB)?.has(fileA)).toBeFalsy();
    expect(getIncludes(fileA)).toBeUndefined();
  });
});
