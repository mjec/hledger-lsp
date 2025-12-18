/**
 * Tests for formatter with balance assertions on postings without amounts
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { FormattingProvider } from '../../src/features/formatter';

describe('Formatter - Balance Assertions Without Amounts', () => {
  let parser: HledgerParser;
  let formatter: FormattingProvider;

  beforeEach(() => {
    parser = new HledgerParser();
    formatter = new FormattingProvider();
  });

  test('should preserve assertion on posting without amount', () => {
    const content = `2025-01-01 Test
    assets:checking    $100 = $100
    expenses:food           = $100
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);
    const edits = formatter.formatDocument(doc, parsed, { tabSize: 4, insertSpaces: true });

    expect(edits).toHaveLength(1);
    const formatted = edits[0].newText;
    const lines = formatted.split('\n');

    // The assertion should be preserved on the second posting
    expect(lines[2]).toContain('=');
    expect(lines[2]).toContain('100');
  });

  test('should align assertions correctly when posting has no amount', () => {
    const content = `2025-01-01 Test
    assets:checking    $100.00 = $100.00
    expenses:food               = $100.00
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    // Format once
    const edits1 = formatter.formatDocument(doc, parsed, { tabSize: 4, insertSpaces: true });
    const formatted1 = edits1[0].newText;


    // Format again (this is where the bug manifests)
    const doc2 = TextDocument.create('file:///test.journal', 'hledger', 2, formatted1);
    const parsed2 = parser.parse(doc2);
    const edits2 = formatter.formatDocument(doc2, parsed2, { tabSize: 4, insertSpaces: true });
    const formatted2 = edits2[0].newText;


    const lines1 = formatted1.split('\n');
    const lines2 = formatted2.split('\n');

    // Both formats should be identical
    expect(formatted1).toBe(formatted2);

    // Both lines should have assertions
    expect(lines1[1]).toContain('= $100.00');
    expect(lines1[2]).toContain('= $100.00');
    expect(lines2[1]).toContain('= $100.00');
    expect(lines2[2]).toContain('= $100.00');

    // Assertions should be aligned
    const assertion1Index = lines1[1].indexOf('=');
    const assertion2Index = lines1[2].indexOf('=');
    expect(assertion1Index).toBeGreaterThan(0);
    expect(assertion2Index).toBeGreaterThan(0);
    expect(assertion1Index).toBe(assertion2Index);
  });

  test('should handle mix of postings with and without amounts', () => {
    const content = `2025-01-01 Opening
    assets:cash                    200 = 600.00
    equity:ob     -200.00 = -600.00
    expenses:test              = -600.00
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const edits1 = formatter.formatDocument(doc, parsed, { tabSize: 4, insertSpaces: true });
    const formatted1 = edits1[0].newText;

    const lines = formatted1.split('\n');

    // All three postings should have assertions
    expect(lines[1]).toContain('=');
    expect(lines[2]).toContain('=');
    expect(lines[3]).toContain('=');

    // Format again to check stability
    const doc2 = TextDocument.create('file:///test.journal', 'hledger', 2, formatted1);
    const parsed2 = parser.parse(doc2);
    const edits2 = formatter.formatDocument(doc2, parsed2, { tabSize: 4, insertSpaces: true });
    const formatted2 = edits2[0].newText;

    expect(formatted1).toBe(formatted2);
  });
});
