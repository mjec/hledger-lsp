import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { HledgerParser } from '../../../src/parser/index';
import { Validator } from '../../../src/features/validator';
import { isConversionAccount } from '../../../src/utils/balanceCalculator';

function imbalances(text: string): string[] {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);

    return new Validator().validate(doc, parsed, { settings: { validation: { balance: true } } })
        .diagnostics
        .map((d: Diagnostic) => d.message)
        .filter((m: string) => m.includes('does not balance'));
}

describe('isConversionAccount', () => {
    // Verified against hledger 1.52.1: these names balance a transaction that also
    // carries a cost, while equity:other and assets:foo do not.
    it.each(['equity:conversion', 'equity:trade', 'equity:trading',
        'EQUITY:Conversion', 'equity:conversion:sub', 'Equity:Trading:Currency:INR-HKD:HKD'])(
        'treats %s as a conversion account',
        (name) => {
            expect(isConversionAccount(name)).toBe(true);
        }
    );

    it.each(['equity:other', 'assets:foo', 'equity', 'expenses:conversion', 'equityconversion'])(
        'does not treat %s as a conversion account',
        (name) => {
            expect(isConversionAccount(name)).toBe(false);
        }
    );
});

describe('transactions with conversion postings', () => {
    // A conversion pair balances each commodity on its own. Applying the explicit
    // cost as well double-counts the exchange, which is what produced the
    // "$135 off / €-100 off" false positives.
    it('accepts a total cost alongside a conversion pair', () => {
        // corpus costs-21.j
        const text = '2011/01/01\n    assets                              $-135\n'
            + '    equity:conversion                   €-100\n'
            + '    equity:conversion                    $135\n'
            + '    expenses:foreign currency    €100 @@ $135\n';

        expect(imbalances(text)).toEqual([]);
    });

    it('accepts a unit cost alongside a conversion pair', () => {
        // corpus costs-26.j
        const text = '2023/05/17 * Transfer\n'
            + '    Assets:BOG:Personal      -84.01 USD @ 2.495 GEL\n'
            + '    Equity:Conversion         84.01 USD\n'
            + '    Equity:Conversion       -209.60 GEL\n'
            + '    Assets:BOG:Personal      209.60 GEL\n';

        expect(imbalances(text)).toEqual([]);
    });

    it('accepts a conversion pair under equity:trading', () => {
        // corpus costs-24.j shape
        const text = '2023-01-01\n    Expenses:Gift                          HKD 118.00\n'
            + '    Expenses:Personal                      HKD 118.00\n'
            + '    Equity:Trading:Currency:INR-HKD:HKD    HKD -236.00\n'
            + '    Equity:Trading:Currency:INR-HKD:INR      2150.77 INR\n'
            + '    Liabilities:Credit-Card                 -2150.77 INR\n';

        expect(imbalances(text)).toEqual([]);
    });

    // Costs still balance transactions that have no conversion postings.
    it('still applies a cost when no conversion posting is present', () => {
        const text = '2011/01/01\n    expenses    €100 @@ $135\n    assets     $-135\n';

        expect(imbalances(text)).toEqual([]);
    });

    it('still reports a genuine imbalance when no conversion posting is present', () => {
        const text = '2011/01/01\n    expenses    €100 @@ $135\n    assets     $-999\n';

        expect(imbalances(text)).toHaveLength(1);
    });

    it('still reports an imbalance when a conversion pair does not itself balance', () => {
        const text = '2011/01/01\n    assets                       $-135\n'
            + '    equity:conversion             €-50\n'
            + '    equity:conversion             $135\n'
            + '    expenses:foreign currency     €100\n';

        expect(imbalances(text)).toHaveLength(1);
    });
});
