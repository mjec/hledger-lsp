import { parseAmount } from '../../src/parser/ast';

describe('amounts written without a leading digit', () => {
    // hledger 1.52.1 reads `.01 EUR` as 0.01 EUR. The amount patterns required a
    // digit before the decimal mark, so these parsed to no amount at all and the
    // posting looked like it was missing one.
    it.each([
        ['.01 EUR', 0.01, 'EUR'],
        ['.1 EUR', 0.1, 'EUR'],
        ['-.1 EUR', -0.1, 'EUR'],
        ['.5', 0.5, ''],
        ['-.25', -0.25, ''],
        ['$.50', 0.5, '$'],
    ])('parses %s as %s %s', (input, quantity, commodity) => {
        const amount = parseAmount(input);
        expect(amount?.quantity).toBeCloseTo(quantity, 10);
        expect(amount?.commodity).toBe(commodity);
    });

    // hledger does not treat a leading comma as a decimal mark: it prints `,5`
    // back unchanged, reading the comma as a symbol rather than 0.5.
    it('does not read a leading comma as a decimal mark', () => {
        expect(parseAmount(',5')?.quantity).not.toBeCloseTo(0.5, 10);
    });

    it('still parses ordinary amounts', () => {
        expect(parseAmount('100 EUR')?.quantity).toBe(100);
        expect(parseAmount('$-1,000.50')?.quantity).toBe(-1000.5);
    });
});

describe('amounts written in scientific notation', () => {
    // hledger 1.52.1 values, from `print --explicit`.
    it.each([
        ['1.05e2', 105, ''],
        ['31415926e-7', 3.1415926, ''],
        ['1E+3', 1000, ''],
        ['1e3', 1000, ''],
        ['1.5E-2', 0.015, ''],
        ['$1.05e2', 105, '$'],
        ['$31415926e-7', 3.1415926, '$'],
        ['$1E+3', 1000, '$'],
        ['-1.05e2', -105, ''],
    ])('parses %s as %s %s', (input, quantity, commodity) => {
        const amount = parseAmount(input);
        expect(amount?.quantity).toBeCloseTo(quantity, 10);
        expect(amount?.commodity).toBe(commodity);
    });

    // The exponent must abut the mantissa. hledger rejects `100 E5`, so the `E5`
    // must not be read as an exponent across the space.
    it('does not read an exponent across a space', () => {
        expect(parseAmount('100 E5')?.quantity).not.toBe(1e7);
    });

    it('still reads a commodity that merely starts with E', () => {
        const amount = parseAmount('100 EUR');
        expect(amount?.quantity).toBe(100);
        expect(amount?.commodity).toBe('EUR');
    });
});

describe('malformed separator sequences are not silently repaired', () => {
    // hledger rejects these with "invalid number (invalid use of separator)". The
    // LSP does not yet report them (that needs parse-error diagnostics), but the
    // leading-zero rule must not rewrite them either: turning `1,0,.0` into
    // `1,0,0.0` changes the value and produced an imbalance that agreed with
    // hledger's rejection purely by accident.
    it('leaves a decimal mark that follows a group separator alone', () => {
        expect(parseAmount('1,0,.0 EUR')?.quantity).not.toBeCloseTo(100, 10);
    });

    it('still supplies the leading zero after a sign or symbol', () => {
        expect(parseAmount('-.25')?.quantity).toBeCloseTo(-0.25, 10);
        expect(parseAmount('$.50')?.quantity).toBeCloseTo(0.5, 10);
    });
});
