
import { formatAmount } from '../../src/utils/amountFormatter';
import { ParsedDocument, Commodity } from '../../src/types';

describe('formatAmount with separators', () => {
    let mockParsed: ParsedDocument;

    beforeEach(() => {
        mockParsed = {
            transactions: [],
            accounts: new Map(),
            commodities: new Map(),
            payees: new Map(),
            tags: new Map(),
            directives: []
        };
    });

    it('should format EUR with dot thousands separator and comma decimal (1.000,00 EUR)', () => {
        // EUR 1.000,00
        const eurFormat = {
            symbol: 'EUR',
            symbolOnLeft: false,
            spaceBetween: true,
            decimalMark: ',',
            thousandsSeparator: '.',
            precision: 2
        } as any;

        mockParsed.commodities.set('EUR', { name: 'EUR', declared: true, format: eurFormat } as Commodity);

        // Test 1000
        expect(formatAmount(1000, 'EUR', mockParsed)).toBe('1.000,00 EUR');
    });

    it('should format USD with comma thousands separator and dot decimal ($1,000.00)', () => {
        // $1,000.00
        const usdFormat = {
            symbol: '$',
            symbolOnLeft: true,
            spaceBetween: false,
            decimalMark: '.',
            thousandsSeparator: ',',
            precision: 2
        } as any;

        mockParsed.commodities.set('$', { name: '$', declared: true, format: usdFormat } as Commodity);

        // Test 1000
        expect(formatAmount(1000, '$', mockParsed)).toBe('$1,000.00');
    });

    it('should handle no thousands separator', () => {
        // 1000.00
        const simpleFormat = {
            symbol: 'CAD',
            decimalMark: '.',
            thousandsSeparator: null,
            precision: 2
        } as any;
        mockParsed.commodities.set('CAD', { name: 'CAD', declared: true, format: simpleFormat } as Commodity);

        expect(formatAmount(1000, 'CAD', mockParsed)).toBe('1000.00 CAD');
    });
});
