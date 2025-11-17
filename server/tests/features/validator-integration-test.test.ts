/**
 * Test to debug the exact validation issue with integration test file
 */

import { validator } from '../../src/features/validator';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parser } from '../../src/parser';
import { defaultFileReader } from '../../src/utils/uri';
import { resolveIncludePath } from '../../src/utils/uri';
import * as path from 'path';
import * as fs from 'fs';

describe('Integration Test File Validation Debug', () => {
  test('should validate the exact integration test file', () => {
    const testFilePath = path.join(__dirname, '..', 'integration', 'level1', 'level2', 'level3', 'test.journal');

    if (!fs.existsSync(testFilePath)) {
      console.log('Test file does not exist, skipping');
      return;
    }

    const content = fs.readFileSync(testFilePath, 'utf8');
    const uri = 'file://' + testFilePath;
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    console.log('File URI:', uri);
    console.log('File content:', content);

    const parsed = parser.parse(doc, {
      baseUri: uri,
      fileReader: defaultFileReader
    });

    console.log('Parsed transactions:', parsed.transactions.length);
    console.log('Parsed directives:', parsed.directives.filter(d => d.type === 'include'));

    // Test path resolution
    const includePath = '/home/patrick/Development/hledger_lsp/server/tests/integration/parentInclude.journal';
    const resolvedPath = resolveIncludePath(includePath, uri);
    console.log('Include path:', includePath);
    console.log('Resolved path:', resolvedPath);

    // Test if file can be read
    const includedDoc = defaultFileReader(resolvedPath);
    console.log('File reader result:', includedDoc ? 'SUCCESS' : 'FAILED');
    if (!includedDoc) {
      console.log('Trying to read directly:', fs.existsSync(resolvedPath.replace('file://', '')));
    }

    const result = validator.validate(doc, parsed, {
      baseUri: uri,
      fileReader: defaultFileReader,
      settings: {
        validation: {
          includeFiles: true
        }
      }
    });

    console.log('Diagnostics:', result.diagnostics);

    const includeDiagnostics = result.diagnostics.filter(d =>
      d.message.includes('Include file not found')
    );

    expect(includeDiagnostics.length).toBe(0);
  });
});
