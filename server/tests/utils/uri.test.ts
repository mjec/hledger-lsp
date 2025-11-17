import { toFilePath, toFileUri, resolveIncludePath } from '../../src/utils/uri';

describe('URI utilities', () => {
  describe('toFilePath', () => {
    test('converts file:// URI to path', () => {
      expect(toFilePath('file:///home/user/test.journal')).toBe('/home/user/test.journal');
    });

    test('decodes URI-encoded characters (spaces)', () => {
      expect(toFilePath('file:///home/user/Cloud%20Storage/test.journal')).toBe('/home/user/Cloud Storage/test.journal');
    });

    test('decodes URI-encoded characters (parentheses and special chars)', () => {
      expect(toFilePath('file:///home/user/My%20Documents%20(2025)/test.journal')).toBe('/home/user/My Documents (2025)/test.journal');
    });

    test('decodes complex path with multiple encoded characters', () => {
      const uri = 'file:///home/user/Sync/user@example.com/Cloud%20Storage/My%20Documents%20(2025)/Reports/Week44/User/work.journal';
      const expected = '/home/user/Sync/user@example.com/Cloud Storage/My Documents (2025)/Reports/Week44/User/work.journal';
      expect(toFilePath(uri)).toBe(expected);
    });

    test('returns path as-is if no file:// prefix', () => {
      expect(toFilePath('/home/user/test.journal')).toBe('/home/user/test.journal');
    });
  });

  describe('toFileUri', () => {
    test('converts path to file:// URI', () => {
      expect(toFileUri('/home/user/test.journal')).toBe('file:///home/user/test.journal');
    });

    test('encodes URI characters (spaces)', () => {
      expect(toFileUri('/home/user/Cloud Storage/test.journal')).toBe('file:///home/user/Cloud%20Storage/test.journal');
    });

    test('encodes URI characters (parentheses)', () => {
      expect(toFileUri('/home/user/My Documents (2025)/test.journal')).toBe('file:///home/user/My%20Documents%20(2025)/test.journal');
    });

    test('encodes complex path with multiple special characters', () => {
      const path = '/home/user/Sync/user@example.com/Cloud Storage/My Documents (2025)/Reports/Week44/User/work.journal';
      const expected = 'file:///home/user/Sync/user@example.com/Cloud%20Storage/My%20Documents%20(2025)/Reports/Week44/User/work.journal';
      expect(toFileUri(path)).toBe(expected);
    });

    test('returns URI as-is if already has file:// prefix', () => {
      expect(toFileUri('file:///home/user/test.journal')).toBe('file:///home/user/test.journal');
    });
  });

  describe('toFilePath and toFileUri are inverses', () => {
    test('roundtrip with spaces', () => {
      const path = '/home/user/Cloud Storage/test.journal';
      expect(toFilePath(toFileUri(path))).toBe(path);
    });

    test('roundtrip with parentheses', () => {
      const path = '/home/user/My Documents (2025)/test.journal';
      expect(toFilePath(toFileUri(path))).toBe(path);
    });

    test('roundtrip with complex path', () => {
      const path = '/home/user/Sync/user@example.com/Cloud Storage/My Documents (2025)/Reports/Week44/User/work.journal';
      expect(toFilePath(toFileUri(path))).toBe(path);
    });
  });

  describe('resolveIncludePath with spaces', () => {
    test('resolves relative path with spaces in base URI', () => {
      const baseUri = 'file:///home/user/Cloud%20Storage/main.journal';
      const includePath = 'declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved).toBe('file:///home/user/Cloud%20Storage/declarations.journal');
    });

    test('resolves relative path with ../ and spaces', () => {
      const baseUri = 'file:///home/user/Sync/user@example.com/Cloud%20Storage/My%20Documents%20(2025)/Reports/Week44/User/work.journal';
      const includePath = '../../../Ledgers/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved).toBe('file:///home/user/Sync/user@example.com/Cloud%20Storage/My%20Documents%20(2025)/Ledgers/declarations.journal');
    });

    test('resolves absolute path', () => {
      const baseUri = 'file:///home/user/Cloud%20Storage/main.journal';
      const includePath = '/etc/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved).toBe('file:///etc/declarations.journal');
    });
  });
});
