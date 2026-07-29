import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { HledgerParser } from '../../../src/parser/index';
import { Validator } from '../../../src/features/validator';

function imbalances(postings: string): string[] {
    const text = `2010/1/1 x\n${postings}`;
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);

    return new Validator().validate(doc, parsed, { settings: { validation: { balance: true } } })
        .diagnostics
        .map((d: Diagnostic) => d.message)
        .filter((m: string) => m.includes('does not balance'));
}

describe('each balancing group must balance on its own', () => {
    // Verified against hledger 1.52.1. Real postings balance among themselves and
    // [balanced virtual] postings among themselves; summing the two together hides
    // a group that does not balance.
    it('reports a balanced-virtual posting with no partner', () => {
        // corpus virtual-postings-02.j — the real group balances, [v] does not.
        expect(imbalances('  [v]  10\n  a  1\n  b\n')).toHaveLength(1);
    });

    it('reports a balanced-virtual group that sums to a non-zero amount', () => {
        expect(imbalances('  [v]  10\n  [w]  -5\n  a  1\n  b  -1\n')).toHaveLength(1);
    });

    it('accepts a balanced-virtual pair that sums to zero', () => {
        expect(imbalances('  [v]  10\n  [w]  -10\n  a  1\n  b\n')).toEqual([]);
    });

    it('accepts an amount-less balanced-virtual posting absorbing its group', () => {
        expect(imbalances('  [v]  10\n  [w]\n  a  1\n  b\n')).toEqual([]);
    });

    it('ignores unbalanced virtual postings entirely', () => {
        expect(imbalances('  (u)  99\n  a  1\n  b  -1\n')).toEqual([]);
    });

    it('still reports a real group that does not balance', () => {
        expect(imbalances('  a  1\n  b  -2\n')).toHaveLength(1);
    });

    it('does not report when the two groups only balance in combination', () => {
        // Real sums to +5 and the virtual group to -5. The total is zero, but each
        // group is off, so hledger rejects it and so must we.
        expect(imbalances('  a  5\n  b  0\n  [v]  -5\n  [w]  0\n')).not.toEqual([]);
    });
});
