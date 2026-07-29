import { parseAmount, parseFormat } from '../../src/parser/ast';
import { Commodity } from '../../src/types';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';

function commodityMap(declaration: string): Map<string, Commodity> {
    const parsed = parseFormat(declaration);
    const map = new Map<string, Commodity>();
    map.set(parsed!.name, { name: parsed!.name, declared: true, format: parsed!.format } as Commodity);
    return map;
}

function parse(text: string) {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    return new HledgerParser().parse(doc);
}

describe('ambiguous single-separator amounts with a known decimal mark', () => {
    // "1,000" is ambiguous on its own. When the decimal mark is known to be ".",
    // the comma must be a digit group separator → 1000. The symbol-on-right
    // pattern captures the trailing space ("1,000 "), which used to defeat the
    // 3-trailing-digits ambiguity check and silently yield 1.
    it.each([
        ['1,000 EUR', 1000],
        ['1,000EUR', 1000],
        ['1,000  EUR', 1000],
        ['-1,000 EUR', -1000],
        ['1,000.00 EUR', 1000],
    ])('parses %s as %s when the decimal mark is "."', (input, expected) => {
        expect(parseAmount(input, '.')?.quantity).toBe(expected);
    });

    it.each([
        ['1.000 EUR', 1000],
        ['1.000EUR', 1000],
        ['-1.000 EUR', -1000],
    ])('parses %s as %s when the decimal mark is ","', (input, expected) => {
        expect(parseAmount(input, ',')?.quantity).toBe(expected);
    });

    it('resolves the comma via a commodity directive declaring "." as the decimal mark', () => {
        const commodities = commodityMap('1,000.00 EUR');
        expect(parseAmount('1,000 EUR', undefined, commodities)?.quantity).toBe(1000);
    });

    it('resolves the comma via a commodity directive with no group separator', () => {
        const commodities = commodityMap('100. EUR');
        expect(parseAmount('1,000 EUR', undefined, commodities)?.quantity).toBe(1000);
    });

    // hledger parity: with no declared format, "1,000" is read as 1.000 == 1.
    // Verified against hledger 1.52.1, which reports the same -999 residue.
    it('keeps hledger behaviour of reading 1,000 as 1 when nothing is declared', () => {
        expect(parseAmount('1,000 EUR')?.quantity).toBe(1);
    });

    it('still treats internal spaces as group separators', () => {
        expect(parseAmount('1 000 000 EUR', '.')?.quantity).toBe(1000000);
    });
});

describe('declared decimal mark in a whole journal', () => {
    // Corpus regressions numbers-09.j and numbers-12.j: both balance under
    // hledger 1.52.1 because the commodity directive fixes "." as the decimal mark.
    it.each([
        ['commodity 1,000.00 EUR', 1000],
        ['commodity 100. EUR', 1000],
    ])('%s makes "1,000 EUR" parse as %s', (declaration, expected) => {
        const parsed = parse(`${declaration}\n\n2017/1/1\n\ta   1,000 EUR\n\tb  -1,000.00 EUR\n`);
        const quantities = parsed.transactions[0].postings.map(p => p.amount?.quantity);
        expect(quantities).toEqual([expected, -1000]);
    });
});
