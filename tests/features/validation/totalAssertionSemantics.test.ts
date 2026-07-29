import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { HledgerParser } from '../../../src/parser/index';
import { Validator } from '../../../src/features/validator';

function assertionErrors(text: string): string[] {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);

    return new Validator().validate(doc, parsed).diagnostics
        .map((d: Diagnostic) => d.message)
        .filter((m: string) => m.includes('Balance assertion failed'));
}

describe('total balance assertions (==)', () => {
    // `==` asserts the account's balance across *all* commodities, so every
    // commodity other than the named one must be zero. hledger 1.52.1 reports
    // "the asserted balance is 0 B but the calculated balance is 1 B" here.
    it('fails when another commodity is non-zero', () => {
        const text = '2013/1/1\n  a   1 A\n  a   1 B\n  b   -1 A\n  b   -1 B\n'
            + '\n2013/1/2\n  a   0 A == 1 A\n  c\n';

        expect(assertionErrors(text)).toHaveLength(1);
    });

    it('passes when the account holds only the asserted commodity', () => {
        const text = '2013/1/1\n  a   1 A\n  b   -1 A\n\n2013/1/2\n  a   0 A == 1 A\n  c\n';

        expect(assertionErrors(text)).toEqual([]);
    });

    it('names the offending commodity', () => {
        const text = '2013/1/1\n  a   1 A\n  a   1 B\n  b   -1 A\n  b   -1 B\n'
            + '\n2013/1/2\n  a   0 A == 1 A\n  c\n';

        expect(assertionErrors(text)[0]).toContain('B');
    });

    // A single `=` only constrains the commodity it names.
    it('does not constrain other commodities for a single =', () => {
        const text = '2013/1/1\n  a   1 A\n  a   1 B\n  b   -1 A\n  b   -1 B\n'
            + '\n2013/1/2\n  a   0 A = 1 A\n  c\n';

        expect(assertionErrors(text)).toEqual([]);
    });

    it('still fails a == whose own commodity is wrong', () => {
        const text = '2013/1/1\n  a   1 A\n  b   -1 A\n\n2013/1/2\n  a   0 A == 5 A\n  c\n';

        expect(assertionErrors(text)).toHaveLength(1);
    });
});
