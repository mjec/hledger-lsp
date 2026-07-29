import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { HledgerParser } from '../../../src/parser/index';
import { Validator } from '../../../src/features/validator';

function imbalanceErrors(text: string): string[] {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);
    const result = new Validator().validate(doc, parsed);

    return result.diagnostics
        .map((d: Diagnostic) => d.message)
        .filter((m: string) => m.includes('does not balance'));
}

describe('transaction balance with balance assignments', () => {
    // An assignment fixes a real amount, so a transaction made only of
    // assignments can genuinely fail to balance. hledger 1.52.1 reports
    // "The real postings' sum should be 0 but is: $-93" for this journal.
    it('reports an imbalance when every posting is an assignment', () => {
        const text = '2013/1/1\n  a   $5\n  b\n\n2013/1/2\n  a  = $6\n  b  = $-99\n';

        expect(imbalanceErrors(text)).toHaveLength(1);
    });

    it('does not report an imbalance when an assignment is absorbed by an auto-balanced posting', () => {
        // `a = $1.3` infers $0.10 and `b` absorbs it, so the transaction balances.
        const text = '2013/1/1\n  a    $1.20\n  b\n\n2013/1/2\n  a           =$1.3\n  b\n';

        expect(imbalanceErrors(text)).toEqual([]);
    });

    it('does not report an imbalance for assignments that do sum to zero', () => {
        const text = '2013/1/1\n  a   $5\n  b\n\n2013/1/2\n  a  = $6\n  b  = $-6\n';

        expect(imbalanceErrors(text)).toEqual([]);
    });

    it('still leaves an ordinary auto-balanced transaction unreported', () => {
        expect(imbalanceErrors('2013/1/1\n  a   $5\n  b\n')).toEqual([]);
    });
});

describe('cost inference after assignment resolution', () => {
    // Once both assignments are resolved the transaction holds exactly two
    // commodities, so hledger infers a total cost to balance it, printing
    // `c  50 B @@ 50 A`. Without re-running cost inference the transaction looks
    // unbalanced in both commodities. Corpus assertions-10.j.
    it('does not report an imbalance for a two-commodity assignment transaction', () => {
        const text = '2013/1/5\n  (c)    100 A\n\n2013/1/5\n  c      = 50 B\n  c      = 50 A\n';

        expect(imbalanceErrors(text)).toEqual([]);
    });
});
