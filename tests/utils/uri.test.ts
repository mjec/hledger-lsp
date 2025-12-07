import { toFilePath, toFileUri, resolveIncludePath, defaultFileReader, resolveIncludePaths } from '../../src/utils/uri';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

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

    test('resolves tilde path to home directory', () => {
      const baseUri = 'file:///some/other/path/main.journal';
      const includePath = '~/ledger/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      const expectedPath = path.join(os.homedir(), 'ledger/declarations.journal');
      expect(resolved).toBe(toFileUri(expectedPath));
    });

    test('resolves bare tilde to home directory', () => {
      const baseUri = 'file:///some/other/path/main.journal';
      const includePath = '~';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved).toBe(toFileUri(os.homedir()));
    });

    test('resolves tilde with user notation', () => {
      const baseUri = 'file:///some/other/path/main.journal';
      const includePath = '~user/ledger.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      // Should resolve relative to home dir (we don't expand ~user differently)
      const expectedPath = path.resolve(os.homedir(), 'user/ledger.journal');
      expect(resolved).toBe(toFileUri(expectedPath));
    });

    test('resolves file:// URI as absolute', () => {
      const baseUri = 'file:///some/other/path/main.journal';
      const includePath = 'file:///absolute/path/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved).toBe('file:///absolute/path/declarations.journal');
    });
  });

  describe('defaultFileReader', () => {
    test('reads existing file', () => {
      // Create a temporary file
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-test-'));
      const tmpFile = path.join(tmpDir, 'test.journal');
      fs.writeFileSync(tmpFile, '2025-01-01 Test\n  Assets:Bank  $100\n  Income:Salary', 'utf-8');

      try {
        const uri = toFileUri(tmpFile);
        const doc = defaultFileReader(uri);

        expect(doc).not.toBeNull();
        expect(doc?.getText()).toContain('2025-01-01 Test');
        expect(doc?.uri).toBe(uri);
      } finally {
        // Cleanup
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
      }
    });

    test('returns null for non-existent file', () => {
      const uri = 'file:///nonexistent/path/test.journal';
      const doc = defaultFileReader(uri);
      expect(doc).toBeNull();
    });

    test('returns null on read error', () => {
      // Try to read a directory as a file (should cause error)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-test-'));
      try {
        const uri = toFileUri(tmpDir);
        const doc = defaultFileReader(uri);
        expect(doc).toBeNull();
      } finally {
        fs.rmdirSync(tmpDir);
      }
    });
  });

  describe('resolveIncludePaths (glob support)', () => {
    let tmpDir: string;

    beforeEach(() => {
      // Create temp directory structure for glob tests
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-glob-'));
      fs.writeFileSync(path.join(tmpDir, 'main.journal'), '', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'one.journal'), '', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'two.journal'), '', 'utf-8');
      fs.mkdirSync(path.join(tmpDir, 'sub'));
      fs.writeFileSync(path.join(tmpDir, 'sub', 'three.journal'), '', 'utf-8');
    });

    afterEach(() => {
      // Cleanup
      if (fs.existsSync(path.join(tmpDir, 'sub', 'three.journal'))) {
        fs.unlinkSync(path.join(tmpDir, 'sub', 'three.journal'));
      }
      if (fs.existsSync(path.join(tmpDir, 'sub'))) {
        fs.rmdirSync(path.join(tmpDir, 'sub'));
      }
      ['main.journal', 'one.journal', 'two.journal'].forEach(f => {
        const fp = path.join(tmpDir, f);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
      if (fs.existsSync(tmpDir)) {
        fs.rmdirSync(tmpDir);
      }
    });

    test('returns single path for non-glob pattern', () => {
      const baseUri = toFileUri(path.join(tmpDir, 'main.journal'));
      const result = resolveIncludePaths('one.journal', baseUri);
      expect(result).toEqual([toFileUri(path.join(tmpDir, 'one.journal'))]);
    });

    test('expands glob pattern in same directory', () => {
      const baseUri = toFileUri(path.join(tmpDir, 'main.journal'));
      const result = resolveIncludePaths('*.journal', baseUri);

      // Should match one.journal and two.journal, but NOT main.journal (the including file)
      expect(result).toHaveLength(2);
      expect(result).toContain(toFileUri(path.join(tmpDir, 'one.journal')));
      expect(result).toContain(toFileUri(path.join(tmpDir, 'two.journal')));
      expect(result).not.toContain(toFileUri(path.join(tmpDir, 'main.journal')));
      expect(result).toEqual(result.slice().sort()); // Should be sorted
    });

    test('expands recursive glob pattern', () => {
      const baseUri = toFileUri(path.join(tmpDir, 'main.journal'));
      const result = resolveIncludePaths('**/*.journal', baseUri);

      // Should match all journal files except main.journal
      expect(result).toHaveLength(3);
      expect(result).toContain(toFileUri(path.join(tmpDir, 'one.journal')));
      expect(result).toContain(toFileUri(path.join(tmpDir, 'two.journal')));
      expect(result).toContain(toFileUri(path.join(tmpDir, 'sub', 'three.journal')));
      expect(result).not.toContain(toFileUri(path.join(tmpDir, 'main.journal')));
    });

    test('handles absolute glob patterns', () => {
      const baseUri = 'file:///some/other/path/main.journal';
      const pattern = `${tmpDir}/*.journal`;
      const result = resolveIncludePaths(pattern, baseUri);

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result).toContain(toFileUri(path.join(tmpDir, 'one.journal')));
      expect(result).toContain(toFileUri(path.join(tmpDir, 'two.journal')));
    });

    test('handles tilde glob patterns', () => {
      // Create a test file in home directory
      const homeTestDir = path.join(os.homedir(), '.hledger-test-glob');
      if (!fs.existsSync(homeTestDir)) {
        fs.mkdirSync(homeTestDir);
      }
      const testFile = path.join(homeTestDir, 'test.journal');
      fs.writeFileSync(testFile, '', 'utf-8');

      try {
        const baseUri = 'file:///some/other/path/main.journal';
        const pattern = '~/.hledger-test-glob/*.journal';
        const result = resolveIncludePaths(pattern, baseUri);

        expect(result).toContain(toFileUri(testFile));
      } finally {
        // Cleanup
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        if (fs.existsSync(homeTestDir)) fs.rmdirSync(homeTestDir);
      }
    });

    test('handles bare tilde in glob', () => {
      const baseUri = 'file:///some/other/path/main.journal';
      const pattern = '~';
      const result = resolveIncludePaths(pattern, baseUri);

      // Bare tilde is not a glob, should return single path
      expect(result).toEqual([toFileUri(os.homedir())]);
    });
  });

  describe('toFilePath error handling', () => {
    test('handles invalid URI encoding gracefully', () => {
      // Malformed percent encoding - should return part as-is if decoding fails
      const uri = 'file:///home/user/test%ZZinvalid.journal';
      const result = toFilePath(uri);
      // Should contain the path even if decoding fails for one component
      expect(result).toContain('test%ZZinvalid.journal');
    });
  });
});
