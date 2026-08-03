/**
 * A posting written with more decimals than its commodity declares must still be
 * formatted.
 *
 * The round-trip safety check used to re-render the amount at the *declared*
 * precision (dropping the amount's own precision), so `£5.175` under
 * `commodity £1,000.00` looked like it would become `£5.17` — a value change —
 * and the formatter silently left the line unaligned.
 */

import { FormattingProvider } from '../../src/features/formatter';
import { isSafeToFormat, getFormatUnsafeReason } from '../../src/features/formattingValidation';
import { HledgerParser } from '../../src/parser';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('formatting amounts more precise than their declared commodity', () => {
  const provider = new FormattingProvider();
  const inlayHintsOff = { showInferredAmounts: false, showRunningBalances: false, showCostConversions: false };

  const content = `commodity £1,000.00

2026-01-02 split
    expenses:food  £5.175
    expenses:food  £5.175
    assets:bank  £-10.35
`;

  const parse = () => {
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    return { doc, parsed: new HledgerParser().parse(doc) };
  };

  it('judges the extra-precision amount safe to format', () => {
    const { parsed } = parse();
    const posting = parsed.transactions[0].postings[0];

    expect(getFormatUnsafeReason(posting.amount!, parsed)).toBeNull();
    expect(isSafeToFormat(posting, parsed)).toBe(true);
  });

  it('aligns the extra-precision postings with the rest of the transaction', () => {
    const { doc, parsed } = parse();
    const edits = provider.formatDocument(doc, parsed, { tabSize: 4, insertSpaces: true }, {}, inlayHintsOff);
    const lines = edits[0].newText.split('\n');

    const foodLines = lines.filter(l => l.includes('expenses:food'));
    const bankLine = lines.find(l => l.includes('assets:bank'))!;

    expect(foodLines).toHaveLength(2);
    // Precision is preserved (never reduced), and decimals line up across postings.
    for (const line of foodLines) {
      expect(line).toContain('£');
      expect(line).toContain('5.175');
      expect(line.indexOf('.')).toBe(bankLine.indexOf('.'));
    }
  });
});
