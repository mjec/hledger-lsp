/**
 * Tests for validator include directive validation with various path types
 */

import { URI } from 'vscode-uri';
import { validator } from '../../src/features/validator';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { defaultFileReader } from '../../src/utils/uri';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Validator Include Directives', () => {
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  const absoluteTestPath = path.join(fixturesPath, 'absolute-test.journal');

  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  test('should not error on valid absolute path include', () => {
    const content = `; Test absolute path
include ${absoluteTestPath}

2024-01-20 * Test
    Assets:Bank    $100
    Expenses:Test $-100
`;

    const uri = URI.file(path.join(fixturesPath, 'validator-test.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    // Should NOT have any diagnostics about missing includes
    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found')
    );
    expect(includeDiagnostics.length).toBe(0);
  });

  test('should not error on valid file:// URI include', () => {
    const fileUri = URI.file(absoluteTestPath).toString();
    const content = `; Test file:// URI
include ${fileUri}

2024-01-21 * Test
    Assets:Bank    $50
    Expenses:Test $-50
`;

    const uri = URI.file(path.join(fixturesPath, 'validator-uri-test.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found')
    );
    expect(includeDiagnostics.length).toBe(0);
  });

  test('should not error on valid relative parent path include', () => {
    const content = `; Test relative parent path
include ../parent.journal

2024-01-22 * Test
    Assets:Bank    $30
    Expenses:Test $-30
`;

    const uri = URI.file(path.join(fixturesPath, 'nested', 'validator-relative-test.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found')
    );
    expect(includeDiagnostics.length).toBe(0);
  });

  test('should error on non-existent absolute path include', () => {
    const nonExistentPath = path.join(os.tmpdir(), 'does-not-exist-validator-test.journal');
    const content = `; Test non-existent absolute path
include ${nonExistentPath}

2024-01-23 * Test
    Assets:Bank    $40
    Expenses:Test $-40
`;

    const uri = URI.file(path.join(fixturesPath, 'validator-nonexistent.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    // Should have error about missing include
    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found')
    );
    expect(includeDiagnostics.length).toBe(1);
  });

  test('should handle tilde expansion in validator', () => {
    const homeDir = require('os').homedir();
    const testFile = path.join(homeDir, '.hledger-validator-test.journal');

    fs.writeFileSync(testFile, `; Temp validator test
account Assets:Temp

2024-01-24 * Temp
    Assets:Temp    $15
    Assets:Bank   $-15
`);

    const content = `; Test tilde expansion in validator
include ~/.hledger-validator-test.journal

2024-01-25 * Main
    Assets:Bank    $25
    Assets:Temp   $-25
`;

    const uri = URI.file(path.join(fixturesPath, 'validator-tilde.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found')
    );
    expect(includeDiagnostics.length).toBe(0);

    // Cleanup
    fs.unlinkSync(testFile);
  });

  test('should use same path resolution as parser', () => {
    // Test that validator and parser resolve paths the same way
    const integrationTestPath = path.join(__dirname, '..', 'integration', 'level1', 'level2', 'level3', 'test.journal');

    if (!fs.existsSync(integrationTestPath)) {
      return;
    }

    const content = fs.readFileSync(integrationTestPath, 'utf8');
    const uri = URI.file(integrationTestPath);
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    // Check if there are any include errors
    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found')
    );

    // Parser successfully parsed the includes, so validator should too
    // If parser found transactions from included files, includes worked
    if (parsed.transactions.length > 0) {
      expect(includeDiagnostics.length).toBe(0);
    }
  });

  test('should not error on valid glob pattern include', () => {
    // Use test-workspace-2 which has 2024/*.journal
    const testWorkspace2 = path.join(__dirname, '..', 'fixtures', 'test-workspace-2');
    const mainJournalPath = path.join(testWorkspace2, 'main.journal');

    if (!fs.existsSync(mainJournalPath)) {
      return; // Skip if test workspace doesn't exist
    }

    const content = fs.readFileSync(mainJournalPath, 'utf8');
    const uri = URI.file(mainJournalPath);
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);

    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    // Should NOT have any diagnostics about missing includes or glob not matching
    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found') ||
      d.message.includes('glob pattern matches no files')
    );
    expect(includeDiagnostics.length).toBe(0);
  });

  test('should error on glob pattern that matches no files', () => {
    const content = `; Test glob pattern that matches nothing
include nonexistent/*.journal

2024-01-26 * Test
    Assets:Bank    $100
    Expenses:Test $-100
`;

    const uri = URI.file(path.join(fixturesPath, 'validator-glob-empty.journal'));
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    // Should have error about glob not matching
    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('glob pattern matches no files')
    );
    expect(includeDiagnostics.length).toBe(1);
    expect(includeDiagnostics[0].message).toContain('nonexistent/*.journal');
  });

  test('should handle multiple glob patterns', () => {
    const content = `; Test multiple glob patterns
include 2024/*.journal
include 2023/*.journal

2024-01-27 * Test
    Assets:Bank    $50
    Expenses:Test $-50
`;

    // Use test-workspace-2 which has 2024/*.journal
    const testWorkspace2 = path.join(__dirname, '..', 'fixtures', 'test-workspace-2');
    const testPath = path.join(testWorkspace2, 'validator-multi-glob.journal');

    const uri = URI.file(testPath);
    const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    // Should have error for 2023/*.journal (no files) but not for 2024/*.journal (has files)
    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('glob pattern matches no files')
    );

    // Should have 1 diagnostic for the 2023 glob that matches nothing
    expect(includeDiagnostics.length).toBe(1);
    expect(includeDiagnostics[0].message).toContain('2023/*.journal');
  });
});
