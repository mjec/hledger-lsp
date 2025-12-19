
import { parseAmount } from '../../src/parser/ast';

describe('parseAmount', () => {

    describe('negative amounts', () => {
        // Pattern 2: Symbol on left, amount matches `([+-]?\d[\d.,\s]*)`
        it('should parse negative amount with symbol prefix: $-100', () => {
            const result = parseAmount('$-100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-100);
            expect(result?.commodity).toBe('$');
        });

        // Pattern 1: Symbol on left, sign prefix: `/^([+-])([^\d\s+-]+)\s*([+-]?\d[\d.,\s]*)$/`
        it('should parse negative sign before symbol: -$100', () => {
            const result = parseAmount('-$100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-100);
            expect(result?.commodity).toBe('$');
        });

        it('should parse negative amount with symbol prefix and space: $ -100', () => {
            const result = parseAmount('$ -100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-100);
            expect(result?.commodity).toBe('$');
        });

        it('should parse negative sign before symbol with space: - $100', () => {
            const result = parseAmount('- $100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-100);
            expect(result?.commodity).toBe('$');
        });

        it('should parse complex formats correctly: $-1,000.50', () => {
            const result = parseAmount('$-1,000.50');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-1000.50);
            expect(result?.commodity).toBe('$');
        });

        it('should parse complex formats correctly: -$1,000.50', () => {
            const result = parseAmount('-$1,000.50');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-1000.50);
            expect(result?.commodity).toBe('$');
        });

        it('should parse negative amount with symbol on right: -100 USD', () => {
            const result = parseAmount('-100 USD');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-100);
            expect(result?.commodity).toBe('USD');
        });

        it('should parse negative amount without symbol: -100', () => {
            const result = parseAmount('-100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(-100);
            expect(result?.commodity).toBe('');
        });
    });

    describe('positive amounts', () => {
        // Pattern 2: Symbol on left, amount matches `([+-]?\d[\d.,\s]*)`
        it('should parse positive amount with symbol prefix: $+100', () => {
            const result = parseAmount('$+100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('$');
        });

        // Pattern 1: Symbol on left, sign prefix: `/^([+-])([^\d\s+-]+)\s*([+-]?\d[\d.,\s]*)$/`
        it('should parse positive sign before symbol: +$100', () => {
            const result = parseAmount('+$100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('$');
        });

        it('should parse positive amount with symbol prefix and space: $ +100', () => {
            const result = parseAmount('$ +100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('$');
        });

        it('should parse positive sign before symbol with space: + $100', () => {
            const result = parseAmount('+ $100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('$');
        });

        it('should parse complex formats correctly: $+1,000.50', () => {
            const result = parseAmount('$+1,000.50');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(1000.50);
            expect(result?.commodity).toBe('$');
        });

        it('should parse complex formats correctly: +$1,000.50', () => {
            const result = parseAmount('+$1,000.50');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(1000.50);
            expect(result?.commodity).toBe('$');
        });

        it('should parse positive amount with symbol on right: +100 USD', () => {
            const result = parseAmount('+100 USD');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('USD');
        });

        it('should parse positive amount without symbol: +100', () => {
            const result = parseAmount('+100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('');
        });

        it('should parse positive amount with decimals: +50.99', () => {
            const result = parseAmount('+50.99');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(50.99);
            expect(result?.commodity).toBe('');
        });
    });

    describe('amounts without explicit sign', () => {
        it('should parse positive amount with symbol (no sign): $100', () => {
            const result = parseAmount('$100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('$');
        });

        it('should parse positive amount without symbol (no sign): 100', () => {
            const result = parseAmount('100');
            expect(result).not.toBeNull();
            expect(result?.quantity).toBe(100);
            expect(result?.commodity).toBe('');
        });
    });

    describe('format.symbol should not include +/- signs', () => {
        it('should not treat + as commodity symbol for +100', () => {
            const result = parseAmount('+100');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('');
            expect(result?.format?.symbol).toBe('');
        });

        it('should not treat - as commodity symbol for -100', () => {
            const result = parseAmount('-100');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('');
            expect(result?.format?.symbol).toBe('');
        });

        it('should not include + in format.symbol for +$100', () => {
            const result = parseAmount('+$100');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('$');
            expect(result?.format?.symbol).toBe('$');
        });

        it('should not include - in format.symbol for -$100', () => {
            const result = parseAmount('-$100');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('$');
            expect(result?.format?.symbol).toBe('$');
        });

        it('should not include + in format.symbol for $+100', () => {
            const result = parseAmount('$+100');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('$');
            expect(result?.format?.symbol).toBe('$');
        });

        it('should not include - in format.symbol for $-100', () => {
            const result = parseAmount('$-100');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('$');
            expect(result?.format?.symbol).toBe('$');
        });

        it('should not include + in format.symbol for +100 USD', () => {
            const result = parseAmount('+100 USD');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('USD');
            expect(result?.format?.symbol).toBe('USD');
        });

        it('should not include - in format.symbol for -100 USD', () => {
            const result = parseAmount('-100 USD');
            expect(result).not.toBeNull();
            expect(result?.commodity).toBe('USD');
            expect(result?.format?.symbol).toBe('USD');
        });
    });
});
