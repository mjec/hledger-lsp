import * as ast from '../../src/parser/ast';

describe('AST Refactoring', () => {
    describe('parseFormat', () => {
        test('should parse simple commodity', () => {
            const result = ast.parseFormat('USD');
            expect(result).toEqual({ name: 'USD' });
        });

        test('should parse commodity with amount', () => {
            const result = ast.parseFormat('$1,000.00');
            expect(result).toEqual({
                name: '$',
                format: {
                    symbol: '$',
                    symbolOnLeft: true,
                    spaceBetween: false,
                    decimalMark: '.',
                    thousandsSeparator: ',',
                    precision: 2
                }
            });
        });

        test('should parse generic sample (no commodity symbol)', () => {
            const result = ast.parseFormat('1,000.00');
            expect(result).toEqual({
                name: '',
                format: {
                    symbol: '',
                    symbolOnLeft: false,
                    spaceBetween: false,
                    decimalMark: '.',
                    thousandsSeparator: ',',
                    precision: 2
                }
            });
        });

        test('should parse sample with space', () => {
            const result = ast.parseFormat('EUR 1.000,00');
            expect(result).toEqual({
                name: 'EUR',
                format: {
                    symbol: 'EUR',
                    symbolOnLeft: true,
                    spaceBetween: true,
                    decimalMark: ',',
                    thousandsSeparator: '.',
                    precision: 2
                }
            });
        });

        test('should parse ambiguous number 1.000 as 1000', () => {
            const result = ast.parseFormat('1.000');
            expect(result).toEqual({
                name: '',
                format: {
                    symbol: '',
                    symbolOnLeft: false,
                    spaceBetween: false,
                    decimalMark: '.', // Ambiguous defaults to decimal mark
                    thousandsSeparator: null,
                    precision: 3
                }
            });
        });

        test('should parse ambiguous number 1,000 as 1000', () => {
            const result = ast.parseFormat('1,000');
            expect(result).toEqual({
                name: '',
                format: {
                    symbol: '',
                    symbolOnLeft: false,
                    spaceBetween: false,
                    decimalMark: ',', // Ambiguous defaults to decimal mark
                    thousandsSeparator: null,
                    precision: 3
                }
            });
        });
    });

    describe('parseAmount', () => {
        test('should parse amount and populate format', () => {
            const result = ast.parseAmount('$1,234.56');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(1234.56);
            expect(result!.commodity).toBe('$');
            expect(result!.format).toEqual({
                symbol: '$',
                symbolOnLeft: true,
                spaceBetween: false,
                decimalMark: '.',
                thousandsSeparator: ',',
                precision: 2
            });
        });

        test('should parse amount without commodity and populate format', () => {
            const result = ast.parseAmount('1,234.56');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(1234.56);
            expect(result!.commodity).toBe('');
            expect(result!.format).toEqual({
                symbol: '',
                symbolOnLeft: false,
                spaceBetween: false,
                decimalMark: '.',
                thousandsSeparator: ',',
                precision: 2
            });
        });

        test('should parse negative amount', () => {
            const result = ast.parseAmount('$-1,234.56');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(-1234.56);
            expect(result!.commodity).toBe('$');
            expect(result!.format).toBeDefined();
            expect(result!.format!.symbol).toBe('$');
        });

        test('should parse amount with comma decimal mark', () => {
            const result = ast.parseAmount('1.234,56');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(1234.56);
            expect(result!.format!.decimalMark).toBe(',');
            expect(result!.format!.thousandsSeparator).toBe('.');
        });

        test('should parse amount with multiple thousands separators', () => {
            const result = ast.parseAmount('1,000,000.00');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(1000000);
            expect(result!.format!.decimalMark).toBe('.');
            expect(result!.format!.thousandsSeparator).toBe(',');
        });

        test('should parse ambiguous amount 1.000 as 1', () => {
            // "In such cases, hledger by default assumes it is a decimal mark, and will parse both of those as 1."
            const result = ast.parseAmount('1.000');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(1); // Parsed as 1.000
            expect(result!.format!.decimalMark).toBe('.');
        });

        test('should parse ambiguous amount 1,000 as 1', () => {
            // "In such cases, hledger by default assumes it is a decimal mark, and will parse both of those as 1."
            const result = ast.parseAmount('1,000');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(1); // Parsed as 1,000
            expect(result!.format!.decimalMark).toBe(',');
        });

        test('should parse trailing decimal mark', () => {
            const result = ast.parseAmount('10.');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(10);
            expect(result!.format!.decimalMark).toBe('.');
        });

        test('should use explicit decimal mark if provided', () => {
            // If we explicitly say . is decimal, then 1,000 should be 1000
            const result = ast.parseAmount('1,000', '.');
            expect(result).not.toBeNull();
            expect(result!.quantity).toBe(1000);
        });
    });
});
