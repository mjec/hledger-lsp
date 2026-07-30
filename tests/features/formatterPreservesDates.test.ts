import { TextDocument } from 'vscode-languageserver-textdocument';
import { formattingProvider } from '../../src/features/formatter';
import { HledgerParser } from '../../src/parser/index';
import { parseTransactionHeader } from '../../src/parser/ast';

/** Format a journal the way `--format` and format-on-save do. */
function format(text: string): string {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);
    const edits = formattingProvider.formatDocument(doc, parsed, { tabSize: 4, insertSpaces: true });

    if (edits.length === 0) return text;
    return edits[0].newText;
}

describe('formatting never rewrites the date the author wrote', () => {
    // Formatting adjusts layout. Rewriting a date changes what the journal says, and
    // `--format -o` and format-on-save both write the result back over the file, so a
    // rewrite here silently corrupts the user's data.
    it.each([
        ['a year-less date under a Y directive', 'Y 2010\n\n1.5 test\n  a  $10\n  b\n', '1.5 test'],
        ['a year-less slash date', 'Y 2010\n\n01/05 test\n  a  $10\n  b\n', '01/05 test'],
        ['a dot-separated full date', '2024.01.05 test\n  a  $10\n  b\n', '2024.01.05 test'],
        ['a slash-separated full date', '2024/01/05 test\n  a  $10\n  b\n', '2024/01/05 test'],
        ['an unpadded full date', '2024-1-5 test\n  a  $10\n  b\n', '2024-1-5 test'],
    ])('preserves %s', (_label, journal, expectedHeader) => {
        expect(format(journal)).toContain(expectedHeader);
    });

    it('does not invent the current year for a year-less date', () => {
        const formatted = format('Y 2010\n\n1.5 test\n  a  $10\n  b\n');

        expect(formatted).not.toMatch(/20\d\d[-/.]01[-/.]05/);
    });

    it('still formats the postings of a transaction with a year-less date', () => {
        const formatted = format('Y 2010\n\n1.5 test\n  a  $10\n  b\n');

        // The amount is still pushed out to the alignment column, so preserving the
        // date has not disabled layout. The exact spacing within the amount is the
        // formatter's own business and not what this test is about.
        expect(formatted).toMatch(/^ {4}a {2,}\$ ?10/m);
    });

    it('preserves a year-less effective date', () => {
        expect(format('Y 2010\n\n1.5=1.6 test\n  a  $10\n  b\n')).toContain('1.5=1.6');
    });
});

describe('formatting preserves virtual posting delimiters', () => {
    // The parser stores the account without its delimiters, so emitting
    // `posting.account` dropped them. That silently moves the posting into a
    // different balancing group — `[v] 10` becoming `v 10` puts it in the real group,
    // which then stops balancing. It is why formatted journals came back unbalanced.
    it('keeps the brackets of a balanced virtual posting', () => {
        const formatted = format('2024-01-01 x\n  a  1\n  b  -1\n  [v]  10\n  [w]  -10\n');

        expect(formatted).toMatch(/^ {4}\[v\]/m);
        expect(formatted).toMatch(/^ {4}\[w\]/m);
    });

    it('keeps the parentheses of an unbalanced virtual posting', () => {
        const formatted = format('2024-01-01 x\n  a  1\n  b  -1\n  (u)  99\n');

        expect(formatted).toMatch(/^ {4}\(u\)/m);
    });

    it('keeps the brackets of an amount-less virtual posting', () => {
        const formatted = format('2024-01-01 x\n  a  1\n  b  -1\n  [v]  10\n  [w]\n');

        expect(formatted).toMatch(/^ {4}\[w\]/m);
    });

    it('leaves a plain account undecorated', () => {
        expect(format('2024-01-01 x\n  a  1\n  b  -1\n')).not.toMatch(/[[\](]/);
    });

    it('lines amounts up allowing for the delimiters', () => {
        // The delimiters widen the account column, so the amounts of bracketed and
        // plain postings must still end in the same column. Amounts are right-aligned,
        // so it is the end of the line that has to match, not where the number starts.
        const formatted = format('2024-01-01 x\n  aaa  1\n  bbb  -1\n  [aaa]  10\n  [bbb]  -10\n');
        const lineEnds = formatted.split('\n')
            .filter(line => /\d$/.test(line))
            .map(line => line.length);

        expect(lineEnds).toHaveLength(4);
        expect(new Set(lineEnds).size).toBe(1);
    });
});

describe('parseTransactionHeader reports the date as written', () => {
    // The resolved date is what validators need; the text as written is what the
    // formatter needs. Conflating them is what caused the rewrite.
    it('gives the resolved date and the original text separately', () => {
        const header = parseTransactionHeader('1.5 test', '2010');

        expect(header?.date).toBe('2010.01.05');
        expect(header?.dateText).toBe('1.5');
    });

    it('reports both identically for a full date', () => {
        const header = parseTransactionHeader('2024.01.05 test');

        expect(header?.date).toBe('2024.01.05');
        expect(header?.dateText).toBe('2024.01.05');
    });

    it('reports the effective date text as written', () => {
        const header = parseTransactionHeader('1.5=1.6 test', '2010');

        expect(header?.effectiveDate).toBe('2010.01.06');
        expect(header?.effectiveDateText).toBe('1.6');
    });
});
