import { validateCommodityDirectives } from '../../../src/features/validation/directives';

function messages(text: string): string[] {
    return validateCommodityDirectives(text.split('\n')).map(d => d.message);
}

describe('commodity directives must show a decimal mark', () => {
    // hledger asks for one so it can tell a digit group separator from a decimal
    // mark: "Please include a decimal point or decimal comma in commodity
    // directives". A directive naming only a symbol is fine.
    it.each(['commodity 1000 EUR', 'commodity A 1', 'commodity 1 000  USD'])(
        'reports %s',
        (line) => {
            expect(messages(line)).toHaveLength(1);
            expect(messages(line)[0]).toContain('decimal');
        }
    );

    it.each([
        'commodity 1000.00 EUR',
        'commodity 100. EUR',
        'commodity 1,000 EUR',
        'commodity $1,000.00000000',
        'commodity A',
        'commodity EUR',
    ])('accepts %s', (line) => {
        expect(messages(line)).toEqual([]);
    });

    it('ignores a trailing comment when looking for the mark', () => {
        expect(messages('commodity 1000 EUR  ; no decimal mark here .')).toHaveLength(1);
    });

    it('leaves other directives alone', () => {
        expect(messages('account assets:bank\nP 2024-01-01 EUR $1\ninclude other.journal')).toEqual([]);
    });
});

describe('a format subdirective must name the same commodity', () => {
    it('reports a format subdirective with no symbol', () => {
        const diagnostics = messages('commodity A\n  format 1.00');

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain('should be the same');
    });

    it('reports a format subdirective naming a different symbol', () => {
        expect(messages('commodity A\n  format B 1.00')).toHaveLength(1);
    });

    it.each(['commodity A\n  format A 1.00', 'commodity A\n  format 1.00 A'])(
        'accepts %s',
        (text) => {
            expect(messages(text)).toEqual([]);
        }
    );

    it('does not confuse a following commodity directive for a subdirective', () => {
        expect(messages('commodity A\ncommodity B')).toEqual([]);
    });
});
