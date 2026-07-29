import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { HledgerParser } from '../../../src/parser/index';
import { Validator } from '../../../src/features/validator';

/** Whether the validator reports an imbalance for a two-posting transaction. */
function imbalanced(first: string, second: string): boolean {
    const text = `2010/1/1\n   a  ${first}\n   b  ${second}\n`;
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);

    return new Validator().validate(doc, parsed, { settings: { validation: { balance: true } } })
        .diagnostics
        .some((d: Diagnostic) => d.message.includes('does not balance'));
}

describe('balance tolerance ignores the precision of a cost', () => {
    // Every expectation is hledger 1.52.1's verdict. The tolerance is half a unit
    // at the precision of the *posting* amounts in that commodity; writing the cost
    // to more decimal places must not tighten it.
    it.each([
        // cost,             posting,        imbalanced?
        ['1C @ $1.0049', '$-1.00', false],
        ['1C @ $1.0051', '$-1.00', true],
        ['1C @ $1.0049', '$-1.0000', true],
        ['1C @ $1.000049', '$-1.0000', false],
        ['1C @ $1.000051', '$-1.0000', true],
        ['1C @ $1.0049', '$-1.000', true],
        ['1C @ $1.5', '$-1.46', true],
        ['1C @ $1.5', '$-1.496', true],
    ])('%s / %s → imbalance reported: %s', (first, second, expected) => {
        expect(imbalanced(first, second)).toBe(expected);
    });

    it('accepts the corpus precision-01 residue', () => {
        // A tiny residue from a high-precision rate, against a whole-number posting.
        expect(imbalanced('55.3653 C @ 30.92189512 D', '-1712 D')).toBe(false);
    });

    it('still reports that residue when the posting is written to 8 places', () => {
        expect(imbalanced('55.3653 C @ 30.92189512 D', '-1712.00000000 D')).toBe(true);
    });

    // When a commodity is only ever reached through costs there is no posting
    // precision to use, so the cost's own precision governs.
    it('falls back to the cost precision when no posting states that commodity', () => {
        expect(imbalanced('1C @ $1.0049', '-1C @ $1.00')).toBe(true);
    });

    // Several postings in one commodity: the finest precision wins.
    it('uses the greatest precision among postings in a commodity', () => {
        const text = '2010/1/1\n   a  $1.00\n   b  $-0.9951\n   c  0 X\n';
        const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
        const parsed = new HledgerParser().parse(doc);
        const reported = new Validator().validate(doc, parsed, { settings: { validation: { balance: true } } })
            .diagnostics.some((d: Diagnostic) => d.message.includes('does not balance'));

        expect(reported).toBe(true);
    });
});
