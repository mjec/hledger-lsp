import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';
import { parseAmount, parsePosting, parsePriceDirective } from '../../src/parser/ast';
import { Validator } from '../../src/features/validator';
import { FormattingProvider } from '../../src/features/formatter';
import { formatAmount } from '../../src/utils/amountFormatter';
import { quoteCommodityIfNeeded } from '../../src/utils/index';
import { isSafeToFormat, isAmountRoundTripSafe } from '../../src/features/formattingValidation';

function parseDoc(content: string) {
  const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
  const parser = new HledgerParser();
  return { doc, parsed: parser.parse(doc) };
}

/**
 * hledger requires commodity symbols that end in a digit (e.g. B3 tickers like
 * "WEGE3") to be wrapped in double quotes. The stored commodity symbol is the
 * unquoted content, matching how the `commodity` directive registers it.
 */
describe('quoted commodity symbols (B3 tickers)', () => {
  describe('parseAmount', () => {
    it('parses a number followed by a quoted commodity: 9 "WEGE3"', () => {
      const result = parseAmount('9 "WEGE3"');
      expect(result).not.toBeNull();
      expect(result?.quantity).toBe(9);
      expect(result?.commodity).toBe('WEGE3');
    });

    it('strips the quotes from the commodity symbol', () => {
      const result = parseAmount('18 "RADL3"');
      expect(result?.commodity).toBe('RADL3');
      expect(result?.commodity).not.toContain('"');
    });

    it('parses a negative quantity with a quoted commodity: -3 "VALE3"', () => {
      const result = parseAmount('-3 "VALE3"');
      expect(result).not.toBeNull();
      expect(result?.quantity).toBe(-3);
      expect(result?.commodity).toBe('VALE3');
    });

    it('parses a quoted commodity on the left: "WEGE3" 9', () => {
      const result = parseAmount('"WEGE3" 9');
      expect(result).not.toBeNull();
      expect(result?.quantity).toBe(9);
      expect(result?.commodity).toBe('WEGE3');
    });

    it('parses a quoted commodity containing spaces: 2 "My Stock"', () => {
      const result = parseAmount('2 "My Stock"');
      expect(result).not.toBeNull();
      expect(result?.quantity).toBe(2);
      expect(result?.commodity).toBe('My Stock');
    });

    it('sets the format symbol to the unquoted commodity', () => {
      const result = parseAmount('9 "WEGE3"');
      expect(result?.format?.symbol).toBe('WEGE3');
    });
  });

  describe('parsePosting with quoted commodity amount and cost', () => {
    it('parses "9 \\"WEGE3\\" @ R$ 43,19" into amount + unit cost', () => {
      const posting = parsePosting('    assets:inter:rv:WEGE3    9 "WEGE3"   @  R$ 43,19');
      expect(posting).not.toBeNull();
      expect(posting?.account).toBe('assets:inter:rv:WEGE3');
      expect(posting?.amount?.quantity).toBe(9);
      expect(posting?.amount?.commodity).toBe('WEGE3');
      expect(posting?.cost?.type).toBe('unit');
      expect(posting?.cost?.amount?.commodity).toBe('R$');
      expect(posting?.cost?.amount?.quantity).toBeCloseTo(43.19);
    });
  });

  describe('parsePriceDirective', () => {
    it('strips quotes from a quoted commodity: P ... "WEGE3" R$ 43,49', () => {
      const result = parsePriceDirective('P 2026-07-16 "WEGE3" R$ 43,49');
      expect(result).not.toBeNull();
      expect(result?.commodity).toBe('WEGE3');
      expect(result?.amount.commodity).toBe('R$');
      expect(result?.amount.quantity).toBeCloseTo(43.49);
    });
  });

  describe('commodity directive registration', () => {
    it('registers the ticker unquoted from `commodity 1. "WEGE3"`', () => {
      const { parsed } = parseDoc('commodity 1. "WEGE3"');
      const commodity = parsed.commodities.get('WEGE3');
      expect(commodity).toBeDefined();
      expect(commodity?.declared).toBe(true);
      // No quoted variant should leak into the map.
      expect(parsed.commodities.has('"WEGE3"')).toBe(false);
    });

    it('price directive commodity matches the declared ticker (single map entry)', () => {
      const { parsed } = parseDoc([
        'commodity 1. "WEGE3"',
        'P 2026-07-16 "WEGE3" R$ 43,49',
      ].join('\n'));
      expect(parsed.commodities.has('WEGE3')).toBe(true);
      expect(parsed.commodities.get('WEGE3')?.declared).toBe(true);
      expect(parsed.commodities.has('"WEGE3"')).toBe(false);
    });
  });

  describe('formatAmount re-adds the quotes', () => {
    const { parsed } = parseDoc([
      'commodity 1. "WEGE3"',
      '',
      '2026-07-16 * Compra',
      '    assets:rv:WEGE3    9 "WEGE3"',
      '    assets:caixa',
    ].join('\n'));

    it('quotes a ticker symbol on output', () => {
      expect(formatAmount(9, 'WEGE3', parsed)).toContain('"WEGE3"');
    });

    it('leaves plain symbols unquoted', () => {
      expect(formatAmount(10, 'USD', parsed)).not.toContain('"');
    });

    it('round-trips: format -> parse gives the same quantity and commodity', () => {
      const formatted = formatAmount(9, 'WEGE3', parsed);
      const reparsed = parseAmount(formatted);
      expect(reparsed).not.toBeNull();
      expect(reparsed?.quantity).toBe(9);
      expect(reparsed?.commodity).toBe('WEGE3');
    });

    it('does not double-quote an already quoted symbol', () => {
      expect(quoteCommodityIfNeeded('"WEGE3"')).toBe('"WEGE3"');
    });

    it('quotes symbols containing spaces', () => {
      expect(quoteCommodityIfNeeded('My Stock')).toBe('"My Stock"');
    });
  });
});

/**
 * The two user-reported regressions for B3 tickers:
 *  1. declared tickers reported as "Undeclared"
 *  2. "N postings without amounts" because the amount fails to parse
 */
describe('B3 ticker regressions (integration)', () => {
  const content = [
    'commodity R$ 1.234,56',
    'commodity 1. "WEGE3"',
    'commodity 1. "VALE3"',
    '',
    'account assets:inter:rv:WEGE3',
    'account assets:inter:rv:VALE3',
    'account assets:inter:investimentos-lump',
    '',
    'P 2026-07-16 "WEGE3" R$ 43,49',
    '',
    '2026-07-16 * Conversão lump -> carteira RV',
    '    assets:inter:rv:WEGE3                    9 "WEGE3"   @  R$ 43,19',
    '    assets:inter:rv:VALE3                    3 "VALE3"   @  R$ 57,77',
    '    assets:inter:investimentos-lump',
  ].join('\n');

  it('does not report declared tickers as undeclared commodities', () => {
    const { doc, parsed } = parseDoc(content);
    const result = new Validator().validate(doc, parsed);
    const undeclared = result.diagnostics.filter(d =>
      d.code === 'undeclared-commodity' && /WEGE3|VALE3/.test(d.message)
    );
    expect(undeclared).toHaveLength(0);
  });

  it('does not report "postings without amounts" for quoted-commodity postings', () => {
    const { doc, parsed } = parseDoc(content);
    const result = new Validator().validate(doc, parsed);
    const missing = result.diagnostics.filter(d => /postings without amounts/.test(d.message));
    expect(missing).toHaveLength(0);
  });

  it('does not report the round-trip failure "9 WEGE3 cannot be parsed back"', () => {
    const { doc, parsed } = parseDoc(content);
    const result = new Validator().validate(doc, parsed);
    const roundTrip = result.diagnostics.filter(d => d.code === 'format-roundtrip-failed');
    expect(roundTrip).toHaveLength(0);
  });

  it('considers quoted-commodity postings safe to format', () => {
    const { parsed } = parseDoc(content);
    const postings = parsed.transactions[0].postings;
    expect(isSafeToFormat(postings[0], parsed)).toBe(true);
    expect(isSafeToFormat(postings[1], parsed)).toBe(true);
  });

  it('parses the quoted amounts on every stock posting', () => {
    const { parsed } = parseDoc(content);
    const tx = parsed.transactions[0];
    expect(tx.postings[0].amount?.commodity).toBe('WEGE3');
    expect(tx.postings[0].amount?.quantity).toBe(9);
    expect(tx.postings[1].amount?.commodity).toBe('VALE3');
    expect(tx.postings[1].amount?.quantity).toBe(3);
  });
});

/**
 * A quoted symbol placed before the number ("WEGE3" 9) must not be split
 * inside the quotes when the format is inferred — a truncated symbol like
 * '"WEGE' used to be stored on the commodity and then written back out,
 * corrupting every posting of that commodity in the file.
 */
describe('quoted commodity before the number', () => {
  it('infers an intact format symbol from `"WEGE3" 9`', () => {
    const amount = parseAmount('"WEGE3" 9');
    expect(amount?.format?.symbol).toBe('WEGE3');
    expect(amount?.format?.symbolOnLeft).toBe(true);
    expect(amount?.format?.spaceBetween).toBe(true);
  });

  it('keeps decimals of the number part: `"WEGE3" 1.234,50`', () => {
    const amount = parseAmount('"WEGE3" 1.234,50');
    expect(amount?.quantity).toBeCloseTo(1234.5);
    expect(amount?.format?.symbol).toBe('WEGE3');
    expect(amount?.format?.decimalMark).toBe(',');
    expect(amount?.format?.precision).toBe(2);
  });

  it('registers an intact inferred format on an undeclared ticker', () => {
    const { parsed } = parseDoc([
      '2026-01-01 x',
      '    a    "WEGE3" 9',
      '    b    $-100',
    ].join('\n'));
    expect(parsed.commodities.get('WEGE3')?.format?.symbol).toBe('WEGE3');
  });

  it('formats back to a parseable amount, quotes intact', () => {
    const content = [
      '2026-01-01 x',
      '    a    "WEGE3" 9',
      '    b    $-100',
      '',
      '2026-01-02 y',
      '    a    5 "WEGE3"',
      '    b    $-50',
    ].join('\n');
    const { doc, parsed } = parseDoc(content);
    const formatted = new FormattingProvider().formatDocument(doc, parsed, {} as never)[0].newText;
    expect(formatted).not.toContain('""');
    for (const line of formatted.split('\n').filter(l => /WEGE3/.test(l))) {
      const amountPart = line.trim().replace(/^\S+\s+/, '');
      const reparsed = parseAmount(amountPart);
      expect(reparsed?.commodity).toBe('WEGE3');
    }
  });
});

describe('round-trip guard covers the commodity, not just the quantity', () => {
  it('rejects an amount whose symbol cannot be written back', () => {
    const { parsed } = parseDoc('2026-01-01 x\n    a    9 USD\n    b');
    // A symbol containing a quote has no writable form: left as-is, not mangled
    // into `""WE3"`, and the guard then refuses to format it.
    expect(quoteCommodityIfNeeded('WE"3')).toBe('WE"3');
    expect(isAmountRoundTripSafe({ quantity: 9, commodity: 'WE"3' }, parsed)).toBe(false);
  });

  it('rejects a commodity whose declared format symbol does not round-trip', () => {
    const { parsed } = parseDoc('commodity 1. "WEGE3"');
    const commodity = parsed.commodities.get('WEGE3')!;
    // A format symbol that disagrees with the commodity it is registered under
    // renders an amount of a different commodity — refuse to rewrite it.
    parsed.commodities.set('WEGE3', { ...commodity, format: { ...commodity.format!, symbol: 'WEGE' } });
    expect(isAmountRoundTripSafe({ quantity: 9, commodity: 'WEGE3' }, parsed)).toBe(false);
  });

  it('still accepts ordinary and quoted-ticker amounts', () => {
    const { parsed } = parseDoc([
      'commodity 1. "WEGE3"',
      'commodity $1,000.00',
    ].join('\n'));
    expect(isAmountRoundTripSafe({ quantity: 9, commodity: 'WEGE3' }, parsed)).toBe(true);
    expect(isAmountRoundTripSafe({ quantity: 10, commodity: '$' }, parsed)).toBe(true);
  });
});
