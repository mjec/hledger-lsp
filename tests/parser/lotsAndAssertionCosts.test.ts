import { parsePosting } from '../../src/parser/ast';
import { HledgerParser } from '../../src/parser/index';
import { Validator } from '../../src/features/validator';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';

/**
 * Balance, missing-amount and assertion diagnostics for a journal. Other checks
 * (undeclared accounts, missing descriptions) are irrelevant here and would
 * otherwise fire from their defaults.
 */
function diagnose(text: string): string[] {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);

    return new Validator().validate(doc, parsed)
        .diagnostics
        .map((d: Diagnostic) => d.message)
        .filter((m: string) =>
            m.includes('does not balance') ||
            m.includes('without amounts') ||
            m.includes('Balance assertion failed') ||
            m.includes('Balance assignments')
        );
}

describe('lot annotations that follow the cost', () => {
    // hledger writes annotations after the cost: `AMOUNT @ COST {LOT} [DATE] (LABEL)`.
    // The stripper used to give up as soon as it saw an `@` before the annotation,
    // so the whole amount failed to parse and the posting looked amount-less.
    it('parses an amount, unit cost and annotation together', () => {
        const posting = parsePosting('    assets:investment    10 AAPL @ $100 {$100} [2026-01-01] (lot A)', '2026-01-01');

        expect(posting?.amount?.quantity).toBe(10);
        expect(posting?.amount?.commodity).toBe('AAPL');
        expect(posting?.cost).toMatchObject({ type: 'unit' });
        expect(posting?.cost?.amount.quantity).toBe(100);
        expect(posting?.cost?.amount.commodity).toBe('$');
        expect(posting?.lotAnnotation).toBe('{$100} [2026-01-01] (lot A)');
    });

    it('still parses an annotation written before the cost', () => {
        const posting = parsePosting('    a    10 AAPL {$100} @ $100', '2026-01-01');

        expect(posting?.amount?.quantity).toBe(10);
        expect(posting?.cost?.amount.quantity).toBe(100);
        expect(posting?.lotAnnotation).toBe('{$100}');
    });

    it('balances the corpus lots-01 journal', () => {
        // hledger auto-balances assets:cash to $-1000 (10 AAPL at $100 each).
        const text = '2026-01-01\n'
            + '    assets:investment    10 AAPL @ $100 {$100} [2026-01-01] (lot A)\n'
            + '    assets:cash\n';

        expect(diagnose(text)).toEqual([]);
    });
});

describe('balance assertions that carry a cost', () => {
    // `= €1 @ $1` asserts a balance of €1 valued at $1. The cost used to defeat the
    // assertion parser entirely, leaving the posting with neither an amount nor an
    // assertion, so it was counted as missing an amount.
    it('parses the asserted amount and its cost', () => {
        const posting = parsePosting('\tassets:eur      = €1 @ $1', '2022-01-02');

        expect(posting?.assertion?.quantity).toBe(1);
        expect(posting?.assertion?.commodity).toBe('€');
        expect(posting?.assertionCost).toMatchObject({ type: 'unit' });
        expect(posting?.assertionCost?.amount.quantity).toBe(1);
        expect(posting?.assertionCost?.amount.commodity).toBe('$');
        expect(posting?.amount).toBeUndefined();
    });

    it('parses a total cost on an assertion', () => {
        const posting = parsePosting('\ta      = €5 @@ $7', '2022-01-02');

        expect(posting?.assertion?.quantity).toBe(5);
        expect(posting?.assertionCost).toMatchObject({ type: 'total' });
        expect(posting?.assertionCost?.amount.quantity).toBe(7);
    });

    it('leaves a plain assertion without a cost', () => {
        const posting = parsePosting('\ta    $1  =$1', '2022-01-02');

        expect(posting?.assertion?.quantity).toBe(1);
        expect(posting?.assertionCost).toBeUndefined();
    });

    it('reports nothing for the corpus assertions-28 journal', () => {
        // hledger accepts this, expanding the costed assignment into conversion
        // postings. We do not model that expansion — what matters is that the
        // posting is recognised as an assignment rather than a missing amount.
        const text = '2022-01-01\n\tassets:eur  €10\n\tequity\n'
            + '\n2022-01-02\n\tassets:eur      = €1 @ $1\n\tassets:usd\n';

        expect(diagnose(text)).toEqual([]);
    });
});
