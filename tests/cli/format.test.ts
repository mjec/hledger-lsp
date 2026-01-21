/**
 * CLI format option tests
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const serverPath = path.join(__dirname, '../../out/server.js');

describe('CLI --format option', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-lsp-test-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('--help', () => {
    test('should show help message', () => {
      const result = execSync(`node "${serverPath}" --help`, { encoding: 'utf-8' });
      expect(result).toContain('hledger-lsp');
      expect(result).toContain('--format');
      expect(result).toContain('--output');
      expect(result).toContain('-o');
      expect(result).toContain('--version');
      expect(result).toContain('--stdio');
    });

    test('-h should also show help', () => {
      const result = execSync(`node "${serverPath}" -h`, { encoding: 'utf-8' });
      expect(result).toContain('--format');
    });
  });

  describe('--version', () => {
    test('should show version', () => {
      const result = execSync(`node "${serverPath}" --version`, { encoding: 'utf-8' });
      expect(result).toMatch(/hledger-lsp v\d+\.\d+\.\d+/);
    });
  });

  describe('format file', () => {
    test('should format a journal file', () => {
      const testFile = path.join(tempDir, 'test1.journal');
      fs.writeFileSync(testFile, `2024-01-01 Test
  expenses:food $10
  assets:cash`);

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });

      // Check formatting was applied (4-space indent, aligned amounts)
      expect(result).toContain('2024-01-01 Test');
      expect(result).toContain('    expenses:food'); // 4-space indent
      expect(result).toContain('$10');
    });

    test('should align decimal points across postings', () => {
      const testFile = path.join(tempDir, 'test2.journal');
      fs.writeFileSync(testFile, `2024-01-01 Test
  expenses:food $10.50
  expenses:drinks $5.00
  assets:cash`);

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });
      const lines = result.split('\n');

      // Find the positions of decimal points - they should be aligned
      const line1 = lines.find(l => l.includes('expenses:food'));
      const line2 = lines.find(l => l.includes('expenses:drinks'));

      expect(line1).toBeDefined();
      expect(line2).toBeDefined();

      const decimalPos1 = line1!.indexOf('.');
      const decimalPos2 = line2!.indexOf('.');

      expect(decimalPos1).toBe(decimalPos2);
    });

    test('should handle file not found error', () => {
      const result = spawnSync('node', [serverPath, '--format', '/nonexistent/file.journal'], {
        encoding: 'utf-8'
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('File not found');
    });

    test('should format transaction with code and status', () => {
      const testFile = path.join(tempDir, 'test3.journal');
      fs.writeFileSync(testFile, `2024-01-01  *  (123)  Grocery store  ; comment
  expenses:food $10
  assets:cash`);

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });

      // Check header is formatted correctly
      expect(result).toContain('2024-01-01 * (123) Grocery store');
      expect(result).toContain('; comment');
    });

    test('should preserve account directives', () => {
      const testFile = path.join(tempDir, 'test4.journal');
      fs.writeFileSync(testFile, `account expenses:food

2024-01-01 Test
  expenses:food $10
  assets:cash`);

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });

      expect(result).toContain('account expenses:food');
    });
  });

  describe('format stdin', () => {
    test('should format stdin input with - argument', () => {
      const input = `2024-01-01 Test
  expenses:food $10
  assets:cash`;

      const result = spawnSync('node', [serverPath, '--format', '-'], {
        input,
        encoding: 'utf-8'
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('2024-01-01 Test');
      expect(result.stdout).toContain('    expenses:food'); // 4-space indent
    });

    test('should format stdin when no file argument provided', () => {
      const input = `2024-01-01 Test
  expenses:food $10
  assets:cash`;

      const result = spawnSync('node', [serverPath, '--format'], {
        input,
        encoding: 'utf-8'
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('    expenses:food'); // 4-space indent
    });
  });

  describe('--output option', () => {
    test('should write formatted output to file with -o', () => {
      const testFile = path.join(tempDir, 'output-test1.journal');
      const outputFile = path.join(tempDir, 'output1.journal');
      fs.writeFileSync(testFile, `2024-01-01 Test
  expenses:food $10
  assets:cash`);

      execSync(`node "${serverPath}" --format "${testFile}" -o "${outputFile}"`, { encoding: 'utf-8' });

      expect(fs.existsSync(outputFile)).toBe(true);
      const content = fs.readFileSync(outputFile, 'utf-8');
      expect(content).toContain('    expenses:food'); // 4-space indent
    });

    test('should write formatted output to file with --output', () => {
      const testFile = path.join(tempDir, 'output-test2.journal');
      const outputFile = path.join(tempDir, 'output2.journal');
      fs.writeFileSync(testFile, `2024-01-01 Test
  expenses:food $10
  assets:cash`);

      execSync(`node "${serverPath}" --format "${testFile}" --output "${outputFile}"`, { encoding: 'utf-8' });

      expect(fs.existsSync(outputFile)).toBe(true);
      const content = fs.readFileSync(outputFile, 'utf-8');
      expect(content).toContain('    expenses:food'); // 4-space indent
    });

    test('should write stdin formatted output to file', () => {
      const outputFile = path.join(tempDir, 'output-stdin.journal');
      const input = `2024-01-01 Test
  expenses:food $10
  assets:cash`;

      const result = spawnSync('node', [serverPath, '--format', '-', '-o', outputFile], {
        input,
        encoding: 'utf-8'
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(outputFile)).toBe(true);
      const content = fs.readFileSync(outputFile, 'utf-8');
      expect(content).toContain('    expenses:food'); // 4-space indent
    });

    test('should handle output to path with spaces', () => {
      const testFile = path.join(tempDir, 'output-test3.journal');
      const outputDir = path.join(tempDir, 'output dir with spaces');
      fs.mkdirSync(outputDir, { recursive: true });
      const outputFile = path.join(outputDir, 'output file.journal');

      fs.writeFileSync(testFile, `2024-01-01 Test
  expenses:food $10
  assets:cash`);

      execSync(`node "${serverPath}" --format "${testFile}" -o "${outputFile}"`, { encoding: 'utf-8' });

      expect(fs.existsSync(outputFile)).toBe(true);
      const content = fs.readFileSync(outputFile, 'utf-8');
      expect(content).toContain('2024-01-01 Test');
    });

    test('should not output to stdout when -o is specified', () => {
      const testFile = path.join(tempDir, 'output-test4.journal');
      const outputFile = path.join(tempDir, 'output4.journal');
      fs.writeFileSync(testFile, `2024-01-01 Test
  expenses:food $10
  assets:cash`);

      const result = execSync(`node "${serverPath}" --format "${testFile}" -o "${outputFile}"`, { encoding: 'utf-8' });

      // stdout should be empty when writing to file
      expect(result).toBe('');
    });

    test('should format in place when input and output are the same file', () => {
      const testFile = path.join(tempDir, 'inplace.journal');
      const originalContent = `2024-01-01 Test
  expenses:food $10
  assets:cash`;

      fs.writeFileSync(testFile, originalContent);

      // Verify file has original (unformatted) content
      expect(fs.readFileSync(testFile, 'utf-8')).toBe(originalContent);

      // Format in place
      execSync(`node "${serverPath}" --format "${testFile}" -o "${testFile}"`, { encoding: 'utf-8' });

      // Verify file was formatted correctly
      const formattedContent = fs.readFileSync(testFile, 'utf-8');
      expect(formattedContent).toContain('    expenses:food'); // 4-space indent
      expect(formattedContent).toContain('2024-01-01 Test');
      expect(formattedContent).toContain('assets:cash');
      // Should not be corrupted or empty
      expect(formattedContent.length).toBeGreaterThan(0);
    });

    test('should preserve all transactions when formatting in place', () => {
      const testFile = path.join(tempDir, 'inplace-multi.journal');
      const originalContent = `2024-01-01 First transaction
  expenses:food $10.50
  assets:cash

2024-01-02 Second transaction
  expenses:utilities $100.00
  assets:bank

2024-01-03 Third transaction
  expenses:transport $25.00
  assets:cash`;

      fs.writeFileSync(testFile, originalContent);

      // Format in place
      execSync(`node "${serverPath}" --format "${testFile}" -o "${testFile}"`, { encoding: 'utf-8' });

      // Verify all transactions are preserved
      const formattedContent = fs.readFileSync(testFile, 'utf-8');
      expect(formattedContent).toContain('2024-01-01 First transaction');
      expect(formattedContent).toContain('2024-01-02 Second transaction');
      expect(formattedContent).toContain('2024-01-03 Third transaction');
      expect(formattedContent).toContain('expenses:food');
      expect(formattedContent).toContain('expenses:utilities');
      expect(formattedContent).toContain('expenses:transport');
      expect(formattedContent).toContain('$10.50');
      expect(formattedContent).toContain('$100.00');
      expect(formattedContent).toContain('$25.00');
    });
  });

  describe('edge cases', () => {
    test('should handle empty file', () => {
      const testFile = path.join(tempDir, 'empty.journal');
      fs.writeFileSync(testFile, '');

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });
      expect(result).toBe('');
    });

    test('should handle file with only comments', () => {
      const testFile = path.join(tempDir, 'comments.journal');
      fs.writeFileSync(testFile, `; This is a comment
; Another comment`);

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });
      expect(result).toContain('; This is a comment');
      expect(result).toContain('; Another comment');
    });

    test('should handle multiple transactions', () => {
      const testFile = path.join(tempDir, 'multi.journal');
      fs.writeFileSync(testFile, `2024-01-01 First
  expenses:a $10
  assets:cash

2024-01-02 Second
  expenses:b $20
  assets:cash`);

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });
      expect(result).toContain('2024-01-01 First');
      expect(result).toContain('2024-01-02 Second');
    });

    test('should handle paths with spaces', () => {
      const dirWithSpaces = path.join(tempDir, 'path with spaces');
      fs.mkdirSync(dirWithSpaces, { recursive: true });
      const testFile = path.join(dirWithSpaces, 'test file.journal');
      fs.writeFileSync(testFile, `2024-01-01 Test
  expenses:food $10
  assets:cash`);

      const result = execSync(`node "${serverPath}" --format "${testFile}"`, { encoding: 'utf-8' });
      expect(result).toContain('2024-01-01 Test');
    });
  });
});
