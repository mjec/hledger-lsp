import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';

function postings(text: string) {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    return new HledgerParser().parse(doc).transactions[0].postings;
}

describe('cost inference only happens when a cost is needed', () => {
    // A transaction whose commodities each already sum to zero needs no cost.
    // hledger 1.52.1 prints these unchanged, with no `@` at all. The LSP used to
    // attach an inferred total cost of zero to the first posting, which then made
    // the balance calculation convert that posting to nothing and report the rest
    // of its commodity as an imbalance.
    it('infers nothing for a conversion-posting transaction that already balances', () => {
        // corpus costs-19.j
        const ps = postings('2011/01/01\n    expenses:foreign currency       €100\n'
            + '    equity:conversion              €-100\n'
            + '    equity:conversion               $135\n'
            + '    assets                         $-135\n');

        expect(ps.map(p => p.cost)).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('infers nothing when the conversion account is named something else', () => {
        // corpus costs-20.j — the account is declared `type:V`, but the arithmetic
        // balances either way, so no cost is needed.
        const ps = postings('2011/01/01\n    expenses:foreign currency   €100\n'
            + '    whoopwhoop                  €-100\n'
            + '    whoopwhoop                   $135\n'
            + '    assets                      $-135\n');

        expect(ps.map(p => p.cost)).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('infers nothing for a balanced transaction with several postings per commodity', () => {
        // corpus costs-24.j
        const ps = postings('2023-01-01\n    Expenses:Gift        HKD 118.00\n'
            + '    Expenses:Personal    HKD 118.00\n'
            + '    Equity:HKD           HKD -236.00\n'
            + '    Equity:INR             2150.77 INR\n'
            + '    Liabilities            -2150.77 INR\n');

        expect(ps.every(p => p.cost === undefined)).toBe(true);
    });

    it('still infers a cost when the commodities do not balance', () => {
        // corpus costs-07.j: € sums to 100 and $ to -135, so a cost is required.
        const ps = postings('2011/01/01\n    expenses:foreign currency        €99\n'
            + '    assets                         $-130\n'
            + '    expenses:foreign currency         €1\n'
            + '    assets                           $-5\n');

        expect(ps.some(p => p.cost?.inferred)).toBe(true);
    });

    it('never infers a cost of zero', () => {
        const ps = postings('2011/01/01\n    a       €100\n    b      €-100\n'
            + '    c        $135\n    d       $-135\n');

        expect(ps.filter(p => p.cost?.amount.quantity === 0)).toEqual([]);
    });
});

describe('inferred cost shape depends on how many postings share the source commodity', () => {
    // hledger prints a total cost when one posting carries the source commodity
    // (`a €100 @@ $135`) but a unit rate when several do (`€99 @ $1.35` and
    // `€1 @ $1.35`). A total cost on the first posting only would leave the others
    // unconverted, showing up as a residue in the source commodity.
    it('infers a total cost when a single posting carries the source commodity', () => {
        const ps = postings('2011/01/01\n  a   €100\n  b  $-135\n');

        expect(ps[0].cost).toMatchObject({ type: 'total', inferred: true });
        expect(ps[0].cost!.amount.quantity).toBe(135);
    });

    it('infers a unit rate on every posting when several share the source commodity', () => {
        // corpus costs-07.j: the rate is the total of the other commodity over the
        // total of this one, 135/100.
        const ps = postings('2011/01/01\n    expenses:foreign currency        €99\n'
            + '    assets                         $-130\n'
            + '    expenses:foreign currency         €1\n'
            + '    assets                           $-5\n');

        expect(ps[0].cost).toMatchObject({ type: 'unit', inferred: true });
        expect(ps[0].cost!.amount.quantity).toBeCloseTo(1.35, 8);
        expect(ps[2].cost).toMatchObject({ type: 'unit', inferred: true });
        expect(ps[2].cost!.amount.quantity).toBeCloseTo(1.35, 8);
        expect(ps[1].cost).toBeUndefined();
        expect(ps[3].cost).toBeUndefined();
    });
});

describe('cost inference needs a genuine exchange', () => {
    // Nothing is being exchanged if one commodity already sums to zero, so there
    // is no rate to infer and the transaction is simply unbalanced. hledger reports
    // "the real postings' sum should be 0 but is: $10.00" here.
    it('infers nothing when the other commodity already sums to zero', () => {
        const ps = postings('2024-01-15 * Store\n    expenses:food  $50.00\n'
            + '    expenses:food  €20.00\n    assets:checking  $-40.00\n'
            + '    assets:checking  €-20.00\n');

        expect(ps.every(p => p.cost === undefined)).toBe(true);
    });

    it('infers nothing when the source commodity sums to zero', () => {
        const ps = postings('2024-01-15 * Store\n    a  €20.00\n    b  €-20.00\n'
            + '    c  $50.00\n    d  $-40.00\n');

        expect(ps.every(p => p.cost === undefined)).toBe(true);
    });
});

describe('an inferred cost implies a positive rate', () => {
    // A cost converts one commodity into another, so the two sums must point in
    // opposite directions. hledger refuses otherwise — corpus costs-10.j is
    // annotated "a balancing cost can not be inferred when BOTH amounts are
    // negative" — because the implied rate would be negative.
    it('infers nothing when both commodities are negative', () => {
        const ps = postings('2011/01/01 x\n  a  -10£\n  b  -16$\n');

        expect(ps.every(p => p.cost === undefined)).toBe(true);
    });

    it('infers nothing when both commodities are positive', () => {
        const ps = postings('2011/01/01 x\n  a  10£\n  b  16$\n');

        expect(ps.every(p => p.cost === undefined)).toBe(true);
    });

    it.each([
        ['10£', '-16$'],
        ['-10£', '16$'],
    ])('still infers for opposite signs (%s / %s)', (first, second) => {
        const ps = postings(`2011/01/01 x\n  a  ${first}\n  b  ${second}\n`);

        expect(ps.some(p => p.cost?.inferred)).toBe(true);
    });
});
