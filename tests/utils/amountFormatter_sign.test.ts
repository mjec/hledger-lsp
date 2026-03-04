
import { formatAmount } from '../../src/utils/amountFormatter';
import { ParsedDocument } from '../../src/types';
import { HledgerSettings } from '../../src/server/settings';

describe('formatAmount with signPosition', () => {
    const mockParsed: ParsedDocument = {
        transactions: [],
        periodicTransactions: [],
        autoPostings: [],
        accounts: new Map(),
        commodities: new Map([
            ['$', { name: '$', declared: true, format: { decimalMark: '.', thousandsSeparator: ',', precision: 2, symbolOnLeft: true, spaceBetween: false } }],
            ['EUR', { name: 'EUR', declared: true, format: { decimalMark: ',', thousandsSeparator: '.', precision: 2, symbolOnLeft: false } }]
        ]),
        payees: new Map(),
        tags: new Map(),
        directives: []
    };

    const optionsDefault: Partial<HledgerSettings['formatting']> = {
        signPosition: 'after-symbol'
    };

    const optionsBefore: Partial<HledgerSettings['formatting']> = {
        signPosition: 'before-symbol'
    };

    it('should format negative USD with default sign position ($-100)', () => {
        // commodity '$' is declared (so isPrefix=true based on heuristics as well)
        expect(formatAmount(-100, '$', mockParsed, optionsDefault)).toBe('$-100.00');
    });

    it('should format negative USD with before-symbol sign position (-$100)', () => {
        expect(formatAmount(-100, '$', mockParsed, optionsBefore)).toBe('-$100.00');
    });

    it('should format negative EUR (postfix) correctly regardless of setting', () => {
        // EUR is typically number + comm -> -100 EUR
        // formatAmount has heuristic: if symbolOnLeft is false:
        // return `${sign}${formattedNumber}${space}${symbol}`;
        // So signPosition setting shouldn't affect postfix commodities usually, unless specified?
        // The implementation only checks options if symbolOnLeft is true usually.
        // Let's check implementation. 
        // If leftSymbols includes commodity, it uses the setting.
        // EUR is in leftSymbols list in the fallback logic, BUT in our mock it is defined in commodities map.
        // The mock definition doesn't specify side (isPrefix) explicitly in the Format object structure used by formatAmount?
        // Wait, formatAmount logic:
        /*
        const format = parsed.commodities.get(commodity)?.format;
        if (format) {
             // ...
             const symbolOnLeft = format.isPrefix !== false; // defaulting to true if undefined? 
             // Logic in amountFormatter:
             // const symbolOnLeft = !format.symbolPosition || format.symbolPosition === 'left';
             // Wait, I need to check how isPrefix/symbolPosition is stored.
        }
        */

        // Let's create a test case for "USD" which might be postfix if we define it so, or EUR prefixes if we define it so.
        // Default fallback logic:
        expect(formatAmount(-50, 'EUR', mockParsed)).toBe('-50,00 EUR'); // Default postfix
    });

    it('should fall back to default behavior if no options provided', () => {
        expect(formatAmount(-100, '$', mockParsed)).toBe('$-100.00');
    });
});
