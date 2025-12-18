import { toFilePath, toFileUri, resolveIncludePath, defaultFileReader, resolveIncludePaths } from '../../src/utils/uri';
import { URI } from 'vscode-uri';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('URI utilities', () => {
  const isWindows = process.platform === 'win32';

  describe('toFilePath', () => {
    // Skip Unix path tests on Windows (vscode-uri converts Unix paths to Windows format)
    test('converts file:// URI to path', () => {
      if (isWindows) return;
      const uri = URI.parse('file:///home/user/test.journal');
      expect(toFilePath(uri)).toBe('/home/user/test.journal');
    });

    test('decodes URI-encoded characters (spaces)', () => {
      if (isWindows) return;
      const uri = URI.parse('file:///home/user/Cloud%20Storage/test.journal');
      expect(toFilePath(uri)).toBe('/home/user/Cloud Storage/test.journal');
    });

    test('decodes URI-encoded characters (parentheses and special chars)', () => {
      if (isWindows) return;
      const uri = URI.parse('file:///home/user/My%20Documents%20(2025)/test.journal');
      expect(toFilePath(uri)).toBe('/home/user/My Documents (2025)/test.journal');
    });

    test('decodes complex path with multiple encoded characters', () => {
      if (isWindows) return;
      const uri = URI.parse('file:///home/user/Sync/user@example.com/Cloud%20Storage/My%20Documents%20(2025)/Reports/Week44/User/work.journal');
      const expected = '/home/user/Sync/user@example.com/Cloud Storage/My Documents (2025)/Reports/Week44/User/work.journal';
      expect(toFilePath(uri)).toBe(expected);
    });
  });

  describe('toFileUri', () => {
    test('converts path to file:// URI', () => {
      const uri = toFileUri('/home/user/test.journal');
      expect(uri.toString()).toBe('file:///home/user/test.journal');
    });

    test('encodes URI characters (spaces)', () => {
      const uri = toFileUri('/home/user/Cloud Storage/test.journal');
      expect(uri.toString()).toBe('file:///home/user/Cloud%20Storage/test.journal');
    });

    test('encodes URI characters (parentheses)', () => {
      const uri = toFileUri('/home/user/My Documents (2025)/test.journal');
      expect(uri.toString()).toBe('file:///home/user/My%20Documents%20%282025%29/test.journal');
    });

    test('encodes complex path with multiple special characters', () => {
      const filePath = '/home/user/Sync/user@example.com/Cloud Storage/My Documents (2025)/Reports/Week44/User/work.journal';
      const uri = toFileUri(filePath);
      expect(uri.toString()).toBe('file:///home/user/Sync/user%40example.com/Cloud%20Storage/My%20Documents%20%282025%29/Reports/Week44/User/work.journal');
    });
  });

  describe('toFilePath and toFileUri are inverses', () => {
    // Skip Unix path tests on Windows (vscode-uri converts Unix paths to Windows format)
    test('roundtrip with spaces', () => {
      if (isWindows) return;
      const path = '/home/user/Cloud Storage/test.journal';
      expect(toFilePath(toFileUri(path))).toBe(path);
    });

    test('roundtrip with parentheses', () => {
      if (isWindows) return;
      const path = '/home/user/My Documents (2025)/test.journal';
      expect(toFilePath(toFileUri(path))).toBe(path);
    });

    test('roundtrip with complex path', () => {
      if (isWindows) return;
      const path = '/home/user/Sync/user@example.com/Cloud Storage/My Documents (2025)/Reports/Week44/User/work.journal';
      expect(toFilePath(toFileUri(path))).toBe(path);
    });
  });

  describe('resolveIncludePath with spaces', () => {
    test('resolves relative path with spaces in base URI', () => {
      const baseUri = URI.parse('file:///home/user/Cloud%20Storage/main.journal');
      const includePath = 'declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved.toString()).toBe('file:///home/user/Cloud%20Storage/declarations.journal');
    });

    test('resolves relative path with ../ and spaces', () => {
      const baseUri = URI.parse('file:///home/user/Sync/user%40example.com/Cloud%20Storage/My%20Documents%20%282025%29/Reports/Week44/User/work.journal');
      const includePath = '../../../Ledgers/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved.toString()).toBe('file:///home/user/Sync/user%40example.com/Cloud%20Storage/My%20Documents%20%282025%29/Ledgers/declarations.journal');
    });

    test('resolves absolute path', () => {
      // Skip on Windows - Unix absolute paths don't make sense there
      if (process.platform === 'win32') {
        return;
      }

      const baseUri = URI.parse('file:///home/user/Cloud%20Storage/main.journal');
      const includePath = '/etc/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved.toString()).toBe('file:///etc/declarations.journal');
    });

    test('resolves tilde path to home directory', () => {
      const baseUri = URI.parse('file:///some/other/path/main.journal');
      const includePath = '~/ledger/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      const expectedPath = path.join(os.homedir(), 'ledger/declarations.journal');
      expect(resolved.toString()).toBe(toFileUri(expectedPath).toString());
    });

    test('resolves bare tilde to home directory', () => {
      const baseUri = URI.parse('file:///some/other/path/main.journal');
      const includePath = '~';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved.toString()).toBe(toFileUri(os.homedir()).toString());
    });

    test('resolves tilde with user notation', () => {
      const baseUri = URI.parse('file:///some/other/path/main.journal');
      const includePath = '~user/ledger.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      // Should resolve relative to home dir (we don't expand ~user differently)
      const expectedPath = path.resolve(os.homedir(), 'user/ledger.journal');
      expect(resolved.toString()).toBe(toFileUri(expectedPath).toString());
    });

    test('resolves file:// URI as absolute', () => {
      const baseUri = URI.parse('file:///some/other/path/main.journal');
      const includePath = 'file:///absolute/path/declarations.journal';
      const resolved = resolveIncludePath(includePath, baseUri);
      expect(resolved.toString()).toBe('file:///absolute/path/declarations.journal');
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
        expect(doc?.uri).toBe(uri.toString());
      } finally {
        // Cleanup
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
      }
    });

    test('returns null for non-existent file', () => {
      const uri = URI.parse('file:///nonexistent/path/test.journal');
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
      const expected = toFileUri(path.join(tmpDir, 'one.journal'));
      expect(result).toHaveLength(1);
      expect(result[0].toString()).toBe(expected.toString());
    });

    test('expands glob pattern in same directory', () => {
      const baseUri = toFileUri(path.join(tmpDir, 'main.journal'));
      const result = resolveIncludePaths('*.journal', baseUri);

      // Should match one.journal and two.journal, but NOT main.journal (the including file)
      expect(result).toHaveLength(2);
      const resultStrings = result.map(uri => uri.toString());
      expect(resultStrings).toContain(toFileUri(path.join(tmpDir, 'one.journal')).toString());
      expect(resultStrings).toContain(toFileUri(path.join(tmpDir, 'two.journal')).toString());
      expect(resultStrings).not.toContain(toFileUri(path.join(tmpDir, 'main.journal')).toString());
      expect(resultStrings).toEqual(resultStrings.slice().sort()); // Should be sorted
    });

    test('expands recursive glob pattern', () => {
      const baseUri = toFileUri(path.join(tmpDir, 'main.journal'));
      const result = resolveIncludePaths('**/*.journal', baseUri);

      // Should match all journal files except main.journal
      expect(result).toHaveLength(3);
      const resultStrings = result.map(uri => uri.toString());
      expect(resultStrings).toContain(toFileUri(path.join(tmpDir, 'one.journal')).toString());
      expect(resultStrings).toContain(toFileUri(path.join(tmpDir, 'two.journal')).toString());
      expect(resultStrings).toContain(toFileUri(path.join(tmpDir, 'sub', 'three.journal')).toString());
      expect(resultStrings).not.toContain(toFileUri(path.join(tmpDir, 'main.journal')).toString());
    });

    test('handles absolute glob patterns', () => {
      const baseUri = URI.parse('file:///some/other/path/main.journal');
      const pattern = `${tmpDir}/*.journal`;
      const result = resolveIncludePaths(pattern, baseUri);

      expect(result.length).toBeGreaterThanOrEqual(2);
      const resultStrings = result.map(uri => uri.toString());
      expect(resultStrings).toContain(toFileUri(path.join(tmpDir, 'one.journal')).toString());
      expect(resultStrings).toContain(toFileUri(path.join(tmpDir, 'two.journal')).toString());
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
        const baseUri = URI.parse('file:///some/other/path/main.journal');
        const pattern = '~/.hledger-test-glob/*.journal';
        const result = resolveIncludePaths(pattern, baseUri);

        const resultStrings = result.map(uri => uri.toString());
        expect(resultStrings).toContain(toFileUri(testFile).toString());
      } finally {
        // Cleanup
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        if (fs.existsSync(homeTestDir)) fs.rmdirSync(homeTestDir);
      }
    });

    test('handles bare tilde in glob', () => {
      const baseUri = URI.parse('file:///some/other/path/main.journal');
      const pattern = '~';
      const result = resolveIncludePaths(pattern, baseUri);

      // Bare tilde is not a glob, should return single path
      expect(result).toHaveLength(1);
      expect(result[0].toString()).toBe(toFileUri(os.homedir()).toString());
    });
  });
});
