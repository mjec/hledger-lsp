import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../../src/parser/index';
import { resolveBalanceAssignments } from '../../../src/features/validation/balanceAssignments';

const URI_STRING = 'file:///t.journal';

/** Parse a journal and resolve its balance assignments, returning the transactions. */
function resolve(text: string) {
    const doc = TextDocument.create(URI_STRING, 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);
    resolveBalanceAssignments(parsed, URI.parse(URI_STRING).toString(), URI.parse(URI_STRING));
    return parsed.transactions;
}

/**
 * Assert a transaction's inferred posting quantities, in file order.
 *
 * Quantities are compared to 8 decimal places: inference subtracts floats, so
 * 1.3 - 1.2 yields 0.10000000000000009. The validators compare with tolerances
 * for the same reason.
 */
function expectQuantities(text: string, index: number, expected: (number | undefined)[]): void {
    const actual = resolve(text)[index].postings.map(p => p.amount?.quantity);

    expect(actual).toHaveLength(expected.length);
    actual.forEach((quantity, i) => {
        if (expected[i] === undefined) {
            expect(quantity).toBeUndefined();
        } else {
            expect(quantity).toBeCloseTo(expected[i]!, 8);
        }
    });
}

describe('resolveBalanceAssignments', () => {
    // Every expectation below is hledger 1.52.1 output (`print --explicit`).

    it('infers the amount as asserted minus the prior balance', () => {
        const text = '2013/1/1\n  a    $1.20\n  b\n\n2013/1/2\n  a           =$1.3\n  b\n';

        expectQuantities(text, 1, [0.1, -0.1]);
    });

    it('sees a prior amount that was itself auto-balanced', () => {
        // b was auto-balanced to $-1, so `b = $-3` infers $-2.
        const text = '2013/1/1\n  a   $1\n  b\n\n2013/1/2\n  b   = $-3\n  c\n';

        expectQuantities(text, 1, [-2, 2]);
    });

    it('sees an explicit earlier posting on the same account in the same transaction', () => {
        const text = '2013/1/1\n  a  $10\n  a  = $30\n  b\n';

        expectQuantities(text, 0, [10, 20, -30]);
    });

    it('does not count a same-transaction posting whose amount is not yet known', () => {
        // corpus assertions-11.j: `(b) = $14` infers 14 even though an earlier `b`
        // posting exists, because that posting still awaits auto-balancing.
        const text = '2013/1/1\n  b\n  [a]    1$\n  (b)     = $14\n  [b]\n  a      4$\n';

        expectQuantities(text, 0, [-4, 1, 14, -1, 4]);
    });

    it('counts real, balanced-virtual and unbalanced-virtual postings in the account balance', () => {
        // After the first transaction b holds -4 + 14 - 1 = 9$, so `b = $9` infers 0.
        const text = '2013/1/1\n  b\n  [a]    1$\n  (b)     = $14\n  [b]\n  a      4$\n'
            + '\n2013/1/2\n  b        = $9\n  c\n';

        expectQuantities(text, 1, [0, 0]);
    });

    it('infers a == assignment the same way as =', () => {
        const text = '2013/1/1\n  a   $5\n  b\n\n2013/1/2\n  a   == $8\n  c\n';

        expectQuantities(text, 1, [3, -3]);
    });

    it('resolves two assignments on one account in different commodities', () => {
        // corpus assertions-10.j: c holds 100 A, so `= 50 B` infers 50 B and
        // `= 50 A` infers -50 A.
        const text = '2013/1/5\n  (c)    100 A\n\n2013/1/5\n  c      = 50 B\n  c      = 50 A\n';

        expectQuantities(text, 1, [50, -50]);
        expect(resolve(text)[1].postings.map(p => p.amount?.commodity)).toEqual(['B', 'A']);
    });

    it('marks inferred assignments so they are distinguishable from auto-balancing', () => {
        const postings = resolve('2013/1/1\n  a  = $5\n  b\n')[0].postings;

        expect(postings[0].isBalanceAssignment).toBe(true);
        expect(postings[0].amount?.inferred).toBe(true);
        // The auto-balanced posting is inferred but is not an assignment.
        expect(postings[1].amount?.inferred).toBe(true);
        expect(postings[1].isBalanceAssignment).toBeFalsy();
    });

    it('leaves a written amount alongside an assertion untouched', () => {
        const postings = resolve('2013/1/1\n  a    $1  =$1\n  b\n')[0].postings;

        expect(postings[0].amount?.quantity).toBe(1);
        expect(postings[0].amount?.inferred).toBeFalsy();
        expect(postings[0].isBalanceAssignment).toBeFalsy();
    });

    it('is idempotent', () => {
        const text = '2013/1/1\n  a    $1.20\n  b\n\n2013/1/2\n  a           =$1.3\n  b\n';
        const doc = TextDocument.create(URI_STRING, 'hledger', 1, text);
        const parsed = new HledgerParser().parse(doc);
        const uri = URI.parse(URI_STRING).toString();

        resolveBalanceAssignments(parsed, uri, URI.parse(URI_STRING));
        resolveBalanceAssignments(parsed, uri, URI.parse(URI_STRING));

        const [first, second] = parsed.transactions[1].postings;
        expect(first.amount?.quantity).toBeCloseTo(0.1, 8);
        expect(second.amount?.quantity).toBeCloseTo(-0.1, 8);
    });
});
