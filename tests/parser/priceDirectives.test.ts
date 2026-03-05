import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';
import { parsePriceDirective } from '../../src/parser/ast';

function parseDoc(content: string) {
  const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
  const parser = new HledgerParser();
  const parsed = parser.parse(doc);
  return { doc, parsed };
}

describe('parsePriceDirective (AST)', () => {
  test('basic price directive with symbol-left commodity', () => {
    const result = parsePriceDirective('P 2024-01-01 EUR $1.10');
    expect(result).not.toBeNull();
    expect(result!.date).toBe('2024-01-01');
    expect(result!.commodity).toBe('EUR');
    expect(result!.amount.quantity).toBeCloseTo(1.10);
    expect(result!.amount.commodity).toBe('$');
  });

  test('basic price directive with symbol-right commodity', () => {
    const result = parsePriceDirective('P 2024-03-15 AAPL 175.50 USD');
    expect(result).not.toBeNull();
    expect(result!.date).toBe('2024-03-15');
    expect(result!.commodity).toBe('AAPL');
    expect(result!.amount.quantity).toBeCloseTo(175.50);
    expect(result!.amount.commodity).toBe('USD');
  });

  test('price directive with comment', () => {
    const result = parsePriceDirective('P 2024-01-01 EUR 1.10 USD  ; ECB rate');
    expect(result).not.toBeNull();
    expect(result!.comment).toBe('ECB rate');
    expect(result!.commodity).toBe('EUR');
    expect(result!.amount.commodity).toBe('USD');
  });

  test('price directive with dot date separator', () => {
    const result = parsePriceDirective('P 2024.01.01 EUR $1.10');
    expect(result).not.toBeNull();
    expect(result!.date).toBe('2024.01.01');
  });

  test('price directive with slash date separator', () => {
    const result = parsePriceDirective('P 2024/01/01 EUR $1.10');
    expect(result).not.toBeNull();
    expect(result!.date).toBe('2024/01/01');
  });

  test('price directive with large amount', () => {
    const result = parsePriceDirective('P 2024-01-01 BTC $42000.00');
    expect(result).not.toBeNull();
    expect(result!.commodity).toBe('BTC');
    expect(result!.amount.quantity).toBeCloseTo(42000.00);
    expect(result!.amount.commodity).toBe('$');
  });

  test('price directive with negative amount', () => {
    const result = parsePriceDirective('P 2024-01-01 LOSS -$50.00');
    expect(result).not.toBeNull();
    expect(result!.amount.quantity).toBeCloseTo(-50.00);
  });

  test('returns null for invalid format', () => {
    expect(parsePriceDirective('P invalid')).toBeNull();
    expect(parsePriceDirective('P 2024-01-01')).toBeNull();
    expect(parsePriceDirective('P 2024-01-01 EUR')).toBeNull();
    expect(parsePriceDirective('account foo')).toBeNull();
    expect(parsePriceDirective('')).toBeNull();
  });

  test('price directive with unicode commodity symbol', () => {
    const result = parsePriceDirective('P 2024-01-01 € $1.10');
    expect(result).not.toBeNull();
    expect(result!.commodity).toBe('€');
    expect(result!.amount.commodity).toBe('$');
  });
});

describe('Price directives via HledgerParser.parse()', () => {
  test('priceDirectives are populated', () => {
    const { parsed } = parseDoc([
      'P 2024-01-01 EUR $1.10',
      'P 2024-06-15 EUR $1.08',
    ].join('\n'));
    expect(parsed.priceDirectives).toHaveLength(2);
    expect(parsed.priceDirectives[0].date).toBe('2024-01-01');
    expect(parsed.priceDirectives[1].date).toBe('2024-06-15');
  });

  test('commodities are extracted from price directives', () => {
    const { parsed } = parseDoc('P 2024-01-01 EUR $1.10');
    expect(parsed.commodities.has('EUR')).toBe(true);
    expect(parsed.commodities.has('$')).toBe(true);
  });

  test('sourceUri and line are set', () => {
    const { parsed } = parseDoc([
      '',
      'P 2024-01-01 EUR $1.10',
    ].join('\n'));
    expect(parsed.priceDirectives[0].line).toBe(1);
    expect(parsed.priceDirectives[0].sourceUri).toBeDefined();
  });

  test('mixed with transactions', () => {
    const { parsed } = parseDoc([
      'P 2024-01-01 EUR $1.10',
      '',
      '2024-01-15 Groceries',
      '    expenses:food    $50',
      '    assets:checking',
      '',
      'P 2024-02-01 EUR $1.12',
    ].join('\n'));
    expect(parsed.priceDirectives).toHaveLength(2);
    expect(parsed.transactions).toHaveLength(1);
  });

  test('price directives do not appear as generic directives', () => {
    const { parsed } = parseDoc('P 2024-01-01 EUR $1.10');
    // Price directives should be handled by the dedicated array, not the generic directives
    const pDirectives = parsed.directives.filter(d => d.type === 'include' || d.value?.startsWith?.('P'));
    expect(pDirectives).toHaveLength(0);
  });

  test('mixed with periodic transactions and auto postings', () => {
    const { parsed } = parseDoc([
      'P 2024-01-01 EUR $1.10',
      '',
      '~ monthly',
      '    expenses:rent    $1500',
      '    assets:checking',
      '',
      '= expenses:food',
      '    budget:food  *-1',
      '',
      'P 2024-06-01 EUR $1.08',
    ].join('\n'));
    expect(parsed.priceDirectives).toHaveLength(2);
    expect(parsed.periodicTransactions).toHaveLength(1);
    expect(parsed.autoPostings).toHaveLength(1);
  });
});
