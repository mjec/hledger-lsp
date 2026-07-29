import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';

function postings(text: string) {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);
    return parsed.transactions[0].postings;
}

describe('auto-balancing is per balancing group', () => {
    // hledger balances real postings among themselves and [balanced virtual]
    // postings among themselves, so each group gets its own inferred posting.
    // Verified against hledger 1.52.1: b => -1, [f] => -10.
    it('infers one amount for the real group and one for the balanced-virtual group', () => {
        const ps = postings('2010/1/1 x\n  a  1\n  b\n  [e]  10\n  [f]\n');

        expect(ps.map(p => p.amount?.quantity)).toEqual([1, -1, 10, -10]);
        expect(ps[1].amount?.inferred).toBe(true);
        expect(ps[3].amount?.inferred).toBe(true);
    });

    it('infers the balanced-virtual amount independently of real amounts', () => {
        const ps = postings('2010/1/1 x\n  a  5\n  b  -5\n  [e]  10\n  [f]\n');

        expect(ps[3].amount?.quantity).toBe(-10);
    });

    it('does not infer when one group has two amount-less postings', () => {
        const ps = postings('2010/1/1 x\n  a  1\n  b\n  c\n');

        expect(ps[1].amount).toBeUndefined();
        expect(ps[2].amount).toBeUndefined();
    });

    it('leaves unbalanced virtual postings out of both groups', () => {
        // (c) never participates in balancing, so the real group is a/b only.
        const ps = postings('2010/1/1 x\n  a  1\n  b\n  (c)  99\n');

        expect(ps[1].amount?.quantity).toBe(-1);
    });

    it('still infers a lone real posting when no virtual postings are present', () => {
        const ps = postings('2010/1/1 x\n  a  7\n  b\n');

        expect(ps[1].amount?.quantity).toBe(-7);
    });
});
