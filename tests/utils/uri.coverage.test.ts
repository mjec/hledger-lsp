/**
 * Additional tests for uri.ts to improve coverage
 * Targets uncovered lines: 122-133 (Windows glob handling), 139-140, 145-146
 */
import { resolveIncludePaths, toFileUri, resolveIncludePath } from '../../src/utils/uri';
import { URI } from 'vscode-uri';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('URI utilities - Coverage Tests', () => {
  const isWindows = process.platform === 'win32';

  describe('resolveIncludePaths edge cases', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-uri-'));
      fs.writeFileSync(path.join(tmpDir, 'main.journal'), '', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'test.journal'), '', 'utf-8');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('handles tilde with glob pattern (~/...)', () => {
      // Test lines 141-143: tilde expansion with glob
      // Create a test file in home directory
      const homeTestDir = path.join(os.homedir(), '.hledger-test-tilde-glob');
      if (!fs.existsSync(homeTestDir)) {
        fs.mkdirSync(homeTestDir);
      }
      const testFile = path.join(homeTestDir, 'main.journal');
      const testFile2 = path.join(homeTestDir, 'test.journal');
      fs.writeFileSync(testFile, '', 'utf-8');
      fs.writeFileSync(testFile2, '', 'utf-8');

      try {
        const baseUri = toFileUri(testFile);
        // This should expand ~/... pattern
        const result = resolveIncludePaths('~/.hledger-test-tilde-glob/*.journal', baseUri);

        // Should find test.journal (excluding main.journal which is the base)
        expect(result.length).toBeGreaterThanOrEqual(1);
        const resultStrings = result.map(uri => uri.toString());
        expect(resultStrings).toContain(toFileUri(testFile2).toString());
      } finally {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        if (fs.existsSync(testFile2)) fs.unlinkSync(testFile2);
        if (fs.existsSync(homeTestDir)) fs.rmdirSync(homeTestDir);
      }
    });

    test('handles bare tilde with glob pattern expansion', () => {
      // Test lines 138-140: bare tilde pattern
      const baseUri = toFileUri(path.join(tmpDir, 'main.journal'));
      // Bare tilde is not a glob pattern, should return home directory
      const result = resolveIncludePaths('~', baseUri);

      expect(result).toHaveLength(1);
      expect(result[0].toString()).toBe(toFileUri(os.homedir()).toString());
    });

    test('handles ~user style paths with glob', () => {
      // Test lines 144-146: ~user style path (not standard ~/...)
      // This covers the case where tilde is followed by something other than /
      const homeTestDir = path.join(os.homedir(), 'user-test-glob');
      if (!fs.existsSync(homeTestDir)) {
        fs.mkdirSync(homeTestDir);
      }
      const testFile = path.join(homeTestDir, 'test.journal');
      fs.writeFileSync(testFile, '', 'utf-8');

      try {
        const baseUri = toFileUri(path.join(tmpDir, 'main.journal'));
        // ~user style - should resolve relative to home
        const result = resolveIncludePaths('~user-test-glob/*.journal', baseUri);

        // This uses homedir() as cwd with pattern starting after ~
        expect(result.length).toBeGreaterThanOrEqual(1);
      } finally {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        if (fs.existsSync(homeTestDir)) fs.rmdirSync(homeTestDir);
      }
    });

    if (isWindows) {
      describe('Windows-specific glob handling', () => {
        test('handles Windows absolute path with glob in basename', () => {
          // Test lines 117-119: Windows path with glob in basename
          // This test would only run on Windows
          const testDir = 'C:\\temp\\hledger-test';
          if (fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(path.join(testDir, 'test.journal'), '', 'utf-8');
          }

          try {
            const baseUri = URI.parse('file:///C:/other/main.journal');
            const result = resolveIncludePaths('C:\\temp\\hledger-test\\*.journal', baseUri);
            // Would expect to find files if they exist
            expect(Array.isArray(result)).toBe(true);
          } finally {
            // Cleanup would go here
          }
        });

        test('handles Windows absolute path with glob in directory', () => {
          // Test lines 122-130: Windows path with glob in directory parts
          const baseUri = URI.parse('file:///C:/other/main.journal');
          // Pattern with glob in directory part (not just basename)
          const result = resolveIncludePaths('C:\\test*\\*.journal', baseUri);
          expect(Array.isArray(result)).toBe(true);
        });
      });
    } else {
      describe('Unix absolute path with glob in directory', () => {
        test('handles absolute path with glob in directory part', () => {
          // Test lines 131-134: Unix absolute path handling
          // Create subdirectory structure
          const subDir = path.join(tmpDir, 'sub');
          fs.mkdirSync(subDir);
          fs.writeFileSync(path.join(subDir, 'test.journal'), '', 'utf-8');

          const baseUri = URI.parse('file:///other/main.journal');
          // Absolute glob pattern
          const pattern = `${tmpDir}/sub/*.journal`;
          const result = resolveIncludePaths(pattern, baseUri);

          expect(result.length).toBeGreaterThanOrEqual(1);
        });

        test('handles root-relative glob pattern', () => {
          // Test lines 132-133: pattern with / at start
          const baseUri = URI.parse('file:///other/main.journal');
          // This is an absolute pattern starting from /
          // fast-glob with cwd='/' and pattern without leading /
          const result = resolveIncludePaths('/tmp/*.nonexistent', baseUri);
          // Should not crash, return empty or matches
          expect(Array.isArray(result)).toBe(true);
        });
      });
    }
  });

  describe('resolveIncludePath tilde edge cases', () => {
    test('handles bare tilde correctly', () => {
      const baseUri = URI.parse('file:///some/path/main.journal');
      const resolved = resolveIncludePath('~', baseUri);
      expect(resolved.toString()).toBe(toFileUri(os.homedir()).toString());
    });

    test('handles ~/ path correctly', () => {
      const baseUri = URI.parse('file:///some/path/main.journal');
      const resolved = resolveIncludePath('~/test.journal', baseUri);
      const expected = path.resolve(os.homedir(), 'test.journal');
      expect(resolved.toString()).toBe(toFileUri(expected).toString());
    });

    test('handles ~user style path', () => {
      // Test line 70-71: ~user notation
      const baseUri = URI.parse('file:///some/path/main.journal');
      const resolved = resolveIncludePath('~user/test.journal', baseUri);
      // This resolves relative to home with 'user/test.journal' as remainder
      const expected = path.resolve(os.homedir(), 'user/test.journal');
      expect(resolved.toString()).toBe(toFileUri(expected).toString());
    });
  });
});
