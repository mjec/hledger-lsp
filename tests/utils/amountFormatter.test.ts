import { formatAmount } from '../../src/utils/amountFormatter';
import { ParsedDocument } from '../../src/types';

describe('formatAmount', () => {
    // Mock ParsedDocument with various commodity formats
    const mockParsedDocument: ParsedDocument = {
        accounts: new Map(),
        transactions: [],
        periodicTransactions: [],
        autoPostings: [],
        directives: [],
        commodities: new Map([
            ['USD', { name: 'USD', declared: true, format: { symbol: '$', symbolOnLeft: true, spaceBetween: false, precision: 2 } }],
            ['EUR', { name: 'EUR', declared: true, format: { symbol: '€', symbolOnLeft: true, spaceBetween: false, precision: 2 } }],
            ['GBP', { name: 'GBP', declared: true, format: { symbol: '£', symbolOnLeft: true, spaceBetween: false, precision: 2 } }],
            ['JPY', { name: 'JPY', declared: true, format: { symbol: '¥', symbolOnLeft: true, spaceBetween: false, precision: 0 } }],
            ['BTC', { name: 'BTC', declared: true, format: { symbol: 'BTC', symbolOnLeft: false, spaceBetween: true, precision: 8 } }],
            ['ETH', { name: 'ETH', declared: true, format: { symbol: 'ETH', symbolOnLeft: true, spaceBetween: true, precision: 6 } }],
            ['CUSTOM', { name: 'CUSTOM', declared: true, format: { symbol: 'C', symbolOnLeft: false, spaceBetween: false, precision: 3 } }],
        ]),
        payees: new Map(),
        tags: new Map(),
    };

    describe('Declared Formats', () => {
        test('should format with symbol on left and no space (USD)', () => {
            expect(formatAmount(50, 'USD', mockParsedDocument)).toBe('$50.00');
            expect(formatAmount(1234.56, 'USD', mockParsedDocument)).toBe('$1234.56');
        });

        test('should format with symbol on right and space (BTC)', () => {
            expect(formatAmount(1.23456789, 'BTC', mockParsedDocument)).toBe('1.23456789 BTC');
        });

        test('should format with symbol on left and space (ETH)', () => {
            expect(formatAmount(10.5, 'ETH', mockParsedDocument)).toBe('ETH 10.500000');
        });

        test('should format with symbol on right and no space (CUSTOM)', () => {
            expect(formatAmount(100, 'CUSTOM', mockParsedDocument)).toBe('100.000C');
        });

        test('should respect custom precision (JPY)', () => {
            expect(formatAmount(1000, 'JPY', mockParsedDocument)).toBe('¥1000');
            expect(formatAmount(1000.5, 'JPY', mockParsedDocument)).toBe('¥1001'); // toFixed rounds
        });
    });

    describe('Default Formatting', () => {
        // Create a document with no commodity info to force defaults
        const emptyParsedDocument: ParsedDocument = {
            accounts: new Map(),
            transactions: [],
            periodicTransactions: [],
            autoPostings: [],
            directives: [],
            commodities: new Map(),
            payees: new Map(),
            tags: new Map(),
        };

        test('should format all currencies on left without space by default', () => {
            // Common symbols (previously heuristic)
            expect(formatAmount(50, '$', emptyParsedDocument)).toBe('$50.00');
            expect(formatAmount(50, '€', emptyParsedDocument)).toBe('€50.00');

            // Other currencies (previously right/space)
            expect(formatAmount(50, 'CAD', emptyParsedDocument)).toBe('CAD50.00');
            expect(formatAmount(50, 'AUD', emptyParsedDocument)).toBe('AUD50.00');
            expect(formatAmount(50, 'UNKNOWN', emptyParsedDocument)).toBe('UNKNOWN50.00');
        });
    });

    describe('Negative Amounts', () => {
        test('should place sign correctly for symbol on left', () => {
            expect(formatAmount(-50, 'USD', mockParsedDocument)).toBe('$-50.00');
        });

        test('should place sign correctly for symbol on right', () => {
            expect(formatAmount(-1.5, 'BTC', mockParsedDocument)).toBe('-1.50000000 BTC');
        });

        test('should place sign correctly for defaults', () => {
            const emptyParsedDocument: ParsedDocument = {
                accounts: new Map(),
                transactions: [],
                periodicTransactions: [],
                autoPostings: [],
                directives: [],
                commodities: new Map(),
                payees: new Map(),
                tags: new Map(),
            };
            // Default is now symbol on left, so sign goes before symbol if configured (default defaults to after-symbol/before-number usually, but let's check formatAmount logic)
            // options default signPosition is 'after-symbol'. 
            // formatAmount defaults: symbolOnLeft=true.
            // If symbolOnLeft=true, negativeSignBefore = (signPosition === 'before-symbol'). Default is 'after-symbol', so negativeSignBefore=false.
            // Result: SYM-50.00
            expect(formatAmount(-50, '$', emptyParsedDocument)).toBe('$-50.00');
            expect(formatAmount(-50, 'CAD', emptyParsedDocument)).toBe('CAD-50.00');
        });


    });

    describe('No Commodity', () => {
        test('should format number with default precision', () => {
            expect(formatAmount(123.456, '', mockParsedDocument)).toBe('123.46');
        });

        test('should format negative number with default precision', () => {
            expect(formatAmount(-123.456, '', mockParsedDocument)).toBe('-123.46');
        });
    });

    describe('Edge Cases', () => {
        test('should handle zero amounts', () => {
            expect(formatAmount(0, 'USD', mockParsedDocument)).toBe('$0.00');
            expect(formatAmount(0, 'BTC', mockParsedDocument)).toBe('0.00000000 BTC');
        });
    });
});
