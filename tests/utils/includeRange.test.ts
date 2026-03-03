import { getIncludePathRange } from '../../src/utils/includeRange';

describe('getIncludePathRange', () => {
  test('should extract simple include path', () => {
    const result = getIncludePathRange('include expenses.journal', 5);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('expenses.journal');
    expect(result!.range.start.line).toBe(5);
    expect(result!.range.start.character).toBe(8);
    expect(result!.range.end.line).toBe(5);
    expect(result!.range.end.character).toBe(24);
  });

  test('should handle extra whitespace after keyword', () => {
    const result = getIncludePathRange('include    expenses.journal', 0);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('expenses.journal');
    expect(result!.range.start.character).toBe(11);
    expect(result!.range.end.character).toBe(27);
  });

  test('should handle trailing comment with semicolon', () => {
    const result = getIncludePathRange('include expenses.journal ; Main expenses', 0);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('expenses.journal');
    expect(result!.range.end.character).toBe(24);
  });

  test('should handle trailing comment with hash', () => {
    const result = getIncludePathRange('include expenses.journal # comment', 0);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('expenses.journal');
    expect(result!.range.end.character).toBe(24);
  });

  test('should return null when no include keyword', () => {
    const result = getIncludePathRange('account expenses:food', 0);

    expect(result).toBeNull();
  });

  test('should return null for empty path', () => {
    const result = getIncludePathRange('include', 0);

    expect(result).toBeNull();
  });

  test('should return null for include with only whitespace after', () => {
    const result = getIncludePathRange('include   ', 0);

    expect(result).toBeNull();
  });

  test('should handle parent directory reference', () => {
    const result = getIncludePathRange('include ../shared/accounts.journal', 2);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('../shared/accounts.journal');
    expect(result!.range.start.line).toBe(2);
    expect(result!.range.start.character).toBe(8);
  });

  test('should handle absolute path', () => {
    const result = getIncludePathRange('include /home/user/main.journal', 0);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('/home/user/main.journal');
    expect(result!.range.start.character).toBe(8);
  });

  test('should handle tilde path', () => {
    const result = getIncludePathRange('include ~/finance/main.journal', 0);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('~/finance/main.journal');
  });

  test('should handle glob pattern', () => {
    const result = getIncludePathRange('include 2024/*.journal', 0);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('2024/*.journal');
  });

  test('should trim trailing whitespace before comment', () => {
    const result = getIncludePathRange('include expenses.journal   ; comment', 0);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('expenses.journal');
    // Should end at position after trimming whitespace
    expect(result!.range.end.character).toBe(24);
  });
});
