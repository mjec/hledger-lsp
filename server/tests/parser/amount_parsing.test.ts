
import { parseAmount } from '../../src/parser/ast';

describe('parseAmount', () => {

    // Pattern 2: Symbol on left, amount matches `([-]?\d[\d.,\s]*)`
    it('should parse negative amount with symbol prefix: $-100', () => {
        const result = parseAmount('$-100');
        expect(result).not.toBeNull();
        expect(result?.quantity).toBe(-100);
        expect(result?.commodity).toBe('$');
    });

    // Pattern 1: Symbol on left, negative: `/^-([^\d\s-]+)\s*([-]?\d[\d.,\s]*)$/`
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
});
