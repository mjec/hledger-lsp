import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';
import { isTransactionHeader } from '../../src/utils/index';

function dates(text: string): string[] {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    return new HledgerParser().parse(doc).transactions.map(t => t.date);
}

describe('year-less dates may use any separator', () => {
    // hledger accepts `1.5`, `1/5` and `1-5` as a year-less date. The dot form was
    // not recognised as a transaction header at all, so the whole entry — postings
    // included — silently vanished from the parse.
    it.each(['01/05 x', '1-5 x', '1.5 x', '01.05 x'])('recognises %s as a transaction header', (line) => {
        expect(isTransactionHeader(line)).toBe(true);
    });

    it('parses a transaction dated with a dot year-less date', () => {
        expect(dates('Y 2010\n\n1.5 x\n   a  1\n   b  -1\n')).toHaveLength(1);
    });
});

describe('the Y directive supplies the year for year-less dates', () => {
    // Verified against hledger 1.52.1: `Y 2010` applies to year-less dates that
    // follow it, each later Y replaces it, and explicit dates are untouched.
    it.each([
        ['01/05', '2010-01-05'],
        ['1.5', '2010-01-05'],
        ['1-5', '2010-01-05'],
    ])('resolves %s against Y 2010', (written, expected) => {
        expect(dates(`Y 2010\n\n${written} x\n   a  1\n   b  -1\n`)[0].replace(/[/.]/g, '-'))
            .toBe(expected);
    });

    it('lets a later Y directive replace an earlier one', () => {
        const parsed = dates('Y 2010\n\n01/05 x\n   a  1\n   b  -1\n'
            + '\nY 2015\n\n02/06 y\n   a  1\n   b  -1\n');

        expect(parsed.map(d => d.replace(/[/.]/g, '-'))).toEqual(['2010-01-05', '2015-02-06']);
    });

    it('leaves an explicit full date alone', () => {
        expect(dates('Y 2010\n\n2024/03/03 x\n   a  1\n   b  -1\n')[0].replace(/[/.]/g, '-'))
            .toBe('2024-03-03');
    });

    it('does not apply a Y directive that comes after the transaction', () => {
        // The date before any Y falls back to the current year, so only assert that
        // it is not the year the later directive names.
        expect(dates('01/05 x\n   a  1\n   b  -1\n\nY 2010\n')[0]).not.toContain('2010');
    });
});
