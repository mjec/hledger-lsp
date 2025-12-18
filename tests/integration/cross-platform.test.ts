/**
 * Cross-platform compatibility tests
 * Tests edge cases for Windows, macOS, and Linux
 */

import { URI } from 'vscode-uri';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { toFilePath, toFileUri, resolveIncludePath, resolveIncludePaths } from '../../src/utils/uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';

describe('Cross-Platform Compatibility Tests', () => {
  const isWindows = process.platform === 'win32';

  // Helper to normalize paths for comparison on Windows (case-insensitive drive letters)
  const normalizePath = (p: string): string => {
    if (!isWindows) return p;
    // Convert drive letter to lowercase for consistent comparison
    return p.replace(/^([A-Z]):/, (match, letter) => letter.toLowerCase() + ':');
  };
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  describe('URI to File Path Conversion', () => {
    test('should handle Unix-style file:// URIs', () => {
      const uri = URI.parse('file:///home/user/documents/test.journal');
      const result = toFilePath(uri);

      if (isWindows) {
        // On Windows, this might be converted to C:\home\user\documents\test.journal
        // or just \home\user\documents\test.journal depending on interpretation
        expect(result).toBeTruthy();
      } else {
        expect(result).toBe('/home/user/documents/test.journal');
      }
    });

    if (isWindows) {
      test('should handle Windows file:// URIs with drive letters', () => {
        const uri = URI.parse('file:///C:/Users/Name/Documents/test.journal');
        const result = toFilePath(uri);

        // Should be C:\Users\Name\Documents\test.journal (or c:\ on Windows)
        expect(result).toMatch(/^[A-Za-z]:[\\\/]/);
        expect(result).toContain('Users');
        expect(result).toContain('test.journal');
        expect(result).not.toMatch(/^[\\\/][A-Za-z]:/); // Should NOT have leading slash
      });

      test('should handle Windows file:// URIs with different drive letters', () => {
        const drives = ['C', 'D', 'E'];

        for (const drive of drives) {
          const uri = URI.parse(`file:///${drive}:/path/to/file.journal`);
          const result = toFilePath(uri);

          // Accept both uppercase and lowercase drive letters
          expect(result).toMatch(new RegExp(`^${drive}:[\\\\\/]`, 'i'));
          expect(result).not.toMatch(/^[\\\/][A-Za-z]:/);
        }
      });

      test('should handle Windows paths with backslashes', () => {
        const winPath = 'C:\\Users\\Name\\Documents\\test.journal';
        const uri = toFileUri(winPath);

        // URI should use forward slashes
        const uriString = uri.toString();
        expect(uriString).toContain('file:///');
        expect(uriString.toLowerCase()).toContain('c:/users/name/documents/test.journal');
        expect(uriString).not.toContain('\\');
      });

      test('should handle mixed forward and backslashes', () => {
        const mixedPath = 'C:/Users\\Name/Documents\\test.journal';
        const uri = toFileUri(mixedPath);

        // Should normalize to forward slashes in URI
        const uriString = uri.toString();
        expect(uriString).toMatch(/file:\/\/\/[Cc]:\/Users\/Name\/Documents\/test\.journal/);
        expect(uriString).not.toContain('\\');
      });
    }

    test('should handle paths with spaces', () => {
      const testPath = isWindows
        ? 'C:\\Program Files\\Test App\\test.journal'
        : '/home/user/My Documents/test.journal';

      const uri = toFileUri(testPath);
      const backToPath = toFilePath(uri);

      // Round-trip should preserve the path (with normalized separators and drive letter casing)
      if (isWindows) {
        // Normalize both to use same separator and lowercase drive letter for comparison
        const normalizedOriginal = normalizePath(testPath.replace(/\//g, path.sep));
        const normalizedResult = normalizePath(backToPath.replace(/\//g, path.sep));
        expect(normalizedResult).toBe(normalizedOriginal);
      } else {
        expect(backToPath).toBe(testPath);
      }
    });

    test('should handle URI-encoded spaces (%20)', () => {
      const uri = URI.parse(isWindows
        ? 'file:///C:/Program%20Files/test.journal'
        : 'file:///home/user/My%20Documents/test.journal');

      const result = toFilePath(uri);

      expect(result).toContain(' ');
      expect(result).not.toContain('%20');
    });

    test('should handle special characters in paths', () => {
      const specialChars = ['&', '(', ')', '[', ']', '#'];

      for (const char of specialChars) {
        const testPath = isWindows
          ? `C:\\Users\\test${char}name\\file.journal`
          : `/home/test${char}name/file.journal`;

        const uri = toFileUri(testPath);
        const backToPath = toFilePath(uri);

        // Round-trip should work (normalize drive letter casing on Windows)
        const normalized = normalizePath(backToPath.replace(/\//g, path.sep));
        const originalNormalized = normalizePath(testPath.replace(/\//g, path.sep));
        expect(normalized).toBe(originalNormalized);
      }
    });
  });

  describe('Include Path Resolution', () => {
    test('should resolve relative paths correctly', () => {
      const baseUri = isWindows
        ? toFileUri('C:\\Users\\Name\\Documents\\main.journal')
        : toFileUri('/home/user/documents/main.journal');

      const includePath = '../other/included.journal';
      const resolved = resolveIncludePath(includePath, baseUri);

      // Should go up one directory and into 'other'
      expect(resolved.toString()).toContain('included.journal');
      expect(resolved.toString()).toContain('other');
      expect(resolved.toString()).not.toContain('documents');
    });

    test('should resolve absolute paths correctly', () => {
      const baseUri = toFileUri('/tmp/main.journal');

      const absolutePath = isWindows
        ? 'C:\\Ledgers\\included.journal'
        : '/etc/ledgers/included.journal';

      const resolved = resolveIncludePath(absolutePath, baseUri);
      const resolvedPath = toFilePath(resolved);

      if (isWindows) {
        expect(resolvedPath).toMatch(/^[A-Za-z]:/);
        expect(resolvedPath).toContain('Ledgers');
      } else {
        expect(resolvedPath).toBe('/etc/ledgers/included.journal');
      }
    });

    test('should handle tilde expansion', () => {
      const baseUri = toFileUri('/tmp/main.journal');
      const homeDir = os.homedir();

      const tildeInclude = '~/ledgers/test.journal';
      const resolved = resolveIncludePath(tildeInclude, baseUri);
      const resolvedPath = toFilePath(resolved);

      // Should expand to home directory (normalize drive letter casing on Windows)
      const normalizedResolved = normalizePath(resolvedPath.replace(/\//g, path.sep));
      const normalizedHome = normalizePath(homeDir.replace(/\//g, path.sep));
      expect(normalizedResolved.startsWith(normalizedHome)).toBe(true);
      expect(normalizedResolved).toContain('ledgers');
      expect(normalizedResolved).toContain('test.journal');
    });

    if (isWindows) {
      test('should handle UNC paths (Windows network shares)', () => {
        // Note: UNC paths are tricky and may not work in all contexts
        // This test documents expected behavior
        const uncPath = '\\\\server\\share\\ledgers\\test.journal';
        const baseUri = toFileUri('C:\\local\\main.journal');

        // path.isAbsolute should return true for UNC paths
        expect(path.isAbsolute(uncPath)).toBe(true);

        // Resolve should handle it
        const resolved = resolveIncludePath(uncPath, baseUri);
        expect(resolved).toBeTruthy();
      });

      test('should handle Windows paths with forward slashes', () => {
        const baseUri = toFileUri('C:/Users/Name/main.journal');
        const includePath = '../other/included.journal';

        const resolved = resolveIncludePath(includePath, baseUri);
        const resolvedPath = toFilePath(resolved);

        expect(resolvedPath).toContain('other');
        expect(resolvedPath).toContain('included.journal');
      });
    }
  });

  describe('Glob Pattern Resolution', () => {
    let tempDir: string;

    beforeEach(() => {
      // Create a temporary directory structure for testing
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-test-'));

      // Create test files
      fs.writeFileSync(path.join(tempDir, 'file1.journal'), '');
      fs.writeFileSync(path.join(tempDir, 'file2.journal'), '');
      fs.mkdirSync(path.join(tempDir, 'subdir'));
      fs.writeFileSync(path.join(tempDir, 'subdir', 'file3.journal'), '');
    });

    afterEach(() => {
      // Clean up
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('should resolve glob patterns in current directory', () => {
      const baseUri = toFileUri(path.join(tempDir, 'main.journal'));
      const pattern = '*.journal';

      const resolved = resolveIncludePaths(pattern, baseUri);

      // Should find file1.journal and file2.journal, not main.journal (excluding base)
      expect(resolved.length).toBeGreaterThanOrEqual(2);
      const paths = resolved.map(uri => toFilePath(uri));

      expect(paths.some(p => p.includes('file1.journal'))).toBe(true);
      expect(paths.some(p => p.includes('file2.journal'))).toBe(true);
      expect(paths.some(p => p.includes('main.journal'))).toBe(false);
    });

    test('should resolve recursive glob patterns', () => {
      const baseUri = toFileUri(path.join(tempDir, 'main.journal'));
      const pattern = '**/*.journal';

      const resolved = resolveIncludePaths(pattern, baseUri);

      // Should find files in current dir and subdirectories
      expect(resolved.length).toBeGreaterThanOrEqual(3);
      const paths = resolved.map(uri => toFilePath(uri));

      expect(paths.some(p => p.includes('file1.journal'))).toBe(true);
      expect(paths.some(p => p.includes('file2.journal'))).toBe(true);
      expect(paths.some(p => p.includes(path.join('subdir', 'file3.journal')))).toBe(true);
    });

    if (isWindows) {
      test('should handle absolute glob patterns on Windows', () => {
        const absPattern = path.join(tempDir, '*.journal').replace(/\\/g, '/');
        const baseUri = toFileUri('C:\\other\\main.journal');

        const resolved = resolveIncludePaths(absPattern, baseUri);

        expect(resolved.length).toBeGreaterThanOrEqual(2);
      });
    }
  });

  describe('Parser Integration with Cross-Platform Paths', () => {
    let tempDir: string;
    let parser: HledgerParser;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-parser-test-'));
      parser = new HledgerParser();
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('should parse files with spaces in path', () => {
      const dirWithSpaces = path.join(tempDir, 'My Documents');
      fs.mkdirSync(dirWithSpaces);

      const mainFile = path.join(dirWithSpaces, 'main.journal');
      const content = `2025-01-01 Test Transaction
    Assets:Cash    $100
    Income:Salary
`;
      fs.writeFileSync(mainFile, content);

      const uri = URI.file(mainFile);
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
      const parsed = parser.parse(doc);

      expect(parsed.transactions.length).toBe(1);
      expect(parsed.transactions[0].payee).toBe('Test Transaction');
    });

    test('should handle includes with relative paths containing ..', () => {
      // Create structure: tempDir/sub1/main.journal includes ../sub2/other.journal
      const sub1 = path.join(tempDir, 'sub1');
      const sub2 = path.join(tempDir, 'sub2');
      fs.mkdirSync(sub1);
      fs.mkdirSync(sub2);

      const otherFile = path.join(sub2, 'other.journal');
      fs.writeFileSync(otherFile, `account Assets:Cash
`);

      const mainFile = path.join(sub1, 'main.journal');
      fs.writeFileSync(mainFile, `include ../sub2/other.journal

2025-01-01 Test
    Assets:Cash    $100
    Income:Salary
`);

      const uri = URI.file(mainFile);
      const content = fs.readFileSync(mainFile, 'utf-8');
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

      const fileReader = (uri: URI) => {
        const filePath = toFilePath(uri);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          return TextDocument.create(uri.toString(), 'hledger', 1, content);
        }
        return null;
      };

      const parsed = parser.parse(doc, { baseUri: uri, fileReader });

      expect(parsed.transactions.length).toBe(1);
      expect(parsed.accounts.has('Assets:Cash')).toBe(true);

      const account = parsed.accounts.get('Assets:Cash');
      expect(account?.declared).toBe(true);
    });

    if (isWindows) {
      test('should handle Windows-style includes', () => {
        const subDir = path.join(tempDir, 'includes');
        fs.mkdirSync(subDir);

        const includedFile = path.join(subDir, 'accounts.journal');
        fs.writeFileSync(includedFile, 'account Assets:Bank\n');

        const mainFile = path.join(tempDir, 'main.journal');
        // Use Windows-style path with backslashes
        const includePathWin = path.relative(tempDir, includedFile);
        fs.writeFileSync(mainFile, `include ${includePathWin}

2025-01-01 Test
    Assets:Bank    $100
    Income:Salary
`);

        const uri = toFileUri(mainFile);
        const content = fs.readFileSync(mainFile, 'utf-8');
        const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

        const fileReader = (uri: URI) => {
          const filePath = toFilePath(uri);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return TextDocument.create(uri.toString(), 'hledger', 1, content);
          }
          return null;
        };

        const parsed = parser.parse(doc, { baseUri: uri, fileReader });

        expect(parsed.transactions.length).toBe(1);
        expect(parsed.accounts.has('Assets:Bank')).toBe(true);

        const account = parsed.accounts.get('Assets:Bank');
        expect(account?.declared).toBe(true);
      });
    }

    if (isMac) {
      test('should handle case-insensitive filesystem (macOS)', () => {
        // macOS has case-insensitive (but case-preserving) filesystem by default
        const mainFile = path.join(tempDir, 'Main.journal');
        const content = `2025-01-01 Test
    Assets:Cash    $100
    Income:Salary
`;
        fs.writeFileSync(mainFile, content);

        // Try to access with different case
        const lowerCaseFile = path.join(tempDir, 'main.journal');

        // On macOS, this should work (case-insensitive)
        expect(fs.existsSync(lowerCaseFile)).toBe(true);

        // URI should work regardless of case
        const uri1 = toFileUri(mainFile);
        const uri2 = toFileUri(lowerCaseFile);

        const doc1 = TextDocument.create(uri1.toString(), 'hledger', 1, content);
        const parsed1 = parser.parse(doc1);

        expect(parsed1.transactions.length).toBe(1);
      });
    }
  });

  describe('Path Normalization', () => {
    test('should normalize paths consistently', () => {
      const testPath = isWindows
        ? 'C:/Users/Name/Documents/test.journal' // Forward slashes
        : '/home/user/documents/test.journal';

      const uri = toFileUri(testPath);
      const backToPath = toFilePath(uri);

      // Normalized path should use platform-specific separators
      if (isWindows) {
        // Could be either forward or back slashes on Windows (accept lowercase drive letter)
        expect(backToPath).toMatch(/^[A-Za-z]:[\\\/]/);
      } else {
        expect(backToPath).toMatch(/^\//);
      }
    });

    test('should handle redundant separators', () => {
      const pathWithRedundant = isWindows
        ? 'C:\\Users\\\\Name\\\\Documents\\test.journal'
        : '/home//user//documents/test.journal';

      // Normalize before converting to URI
      const normalizedInput = path.normalize(pathWithRedundant);
      const uri = toFileUri(normalizedInput);
      const normalized = toFilePath(uri);

      // After normalization, should not have double separators
      expect(normalized).not.toMatch(/[\\\/]{2,}/);
    });

    test('should handle paths with . and ..', () => {
      const pathWithDots = isWindows
        ? 'C:\\Users\\Name\\..\\Other\\Documents\\./test.journal'
        : '/home/user/../other/documents/./test.journal';

      const uri = toFileUri(path.normalize(pathWithDots));
      const normalized = toFilePath(uri);

      // After normalization, should not contain . or ..
      if (isWindows) {
        expect(normalized).toContain('Other');
        expect(normalized).not.toContain('Name');
      } else {
        expect(normalized).toContain('other');
        expect(normalized).not.toContain('user');
      }
    });
  });
});
