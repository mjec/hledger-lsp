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
