import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';
import { Validator } from '../../src/features/validator';
import { SemanticTokensProvider, TokenType, TokenModifier } from '../../src/features/semanticTokens';
import { DocumentSymbolProvider } from '../../src/features/symbols';
import { FindReferencesProvider } from '../../src/features/findReferences';
import { HoverProvider } from '../../src/features/hover';
import { CompletionProvider } from '../../src/features/completion';
import { Range, SymbolKind } from 'vscode-languageserver';

function parseDoc(content: string) {
  const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
  const parser = new HledgerParser();
  const parsed = parser.parse(doc);
  return { doc, parsed };
}

describe('Price Directive Feature Integration', () => {

  describe('Semantic Tokens', () => {
    const provider = new SemanticTokensProvider();

    function getTokens(content: string) {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const data = provider.provideSemanticTokens(doc);
      const tokens: Array<{ line: number; char: number; length: number; type: number; mods: number }> = [];
      let line = 0, char = 0;
      for (let i = 0; i < data.length; i += 5) {
        line += data[i];
        if (data[i] !== 0) char = 0;
        char += data[i + 1];
        tokens.push({ line, char, length: data[i + 2], type: data[i + 3], mods: data[i + 4] });
      }
      return tokens;
    }

    test('P is tokenized as keyword', () => {
      const tokens = getTokens('P 2024-01-01 EUR $1.10\n');
      const pToken = tokens.find(t => t.line === 0 && t.char === 0 && t.type === TokenType.keyword);
      expect(pToken).toBeDefined();
      expect(pToken!.length).toBe(1);
    });

    test('date is tokenized as keyword with readonly modifier', () => {
      const tokens = getTokens('P 2024-01-01 EUR $1.10\n');
      const dateToken = tokens.find(t => t.line === 0 && t.type === TokenType.keyword && t.mods === (1 << TokenModifier.readonly));
      expect(dateToken).toBeDefined();
      expect(dateToken!.length).toBe(10);
    });

    test('base commodity is tokenized as variable', () => {
      const tokens = getTokens('P 2024-01-01 EUR $1.10\n');
      const commodityToken = tokens.find(t => t.line === 0 && t.type === TokenType.variable && t.length === 3);
      expect(commodityToken).toBeDefined();
    });

    test('amount number is tokenized', () => {
      const tokens = getTokens('P 2024-01-01 EUR $1.10\n');
      const numberToken = tokens.find(t => t.line === 0 && t.type === TokenType.number);
      expect(numberToken).toBeDefined();
    });

    test('comment is tokenized', () => {
      const tokens = getTokens('P 2024-01-01 EUR $1.10 ; market rate\n');
      const commentToken = tokens.find(t => t.line === 0 && t.type === TokenType.comment);
      expect(commentToken).toBeDefined();
    });
  });

  describe('Document Symbols', () => {
    const symbolProvider = new DocumentSymbolProvider();

    test('price directive appears in symbols with Constant kind', () => {
      const { doc, parsed } = parseDoc('P 2024-01-01 EUR $1.10');
      const symbols = symbolProvider.provideDocumentSymbols(doc, parsed);
      const priceSymbol = symbols.find(s => s.name.startsWith('P '));
      expect(priceSymbol).toBeDefined();
      expect(priceSymbol!.kind).toBe(SymbolKind.Constant);
      expect(priceSymbol!.name).toContain('EUR');
    });

    test('multiple price directives produce multiple symbols', () => {
      const { doc, parsed } = parseDoc([
        'P 2024-01-01 EUR $1.10',
        'P 2024-06-01 EUR $1.08',
      ].join('\n'));
      const symbols = symbolProvider.provideDocumentSymbols(doc, parsed);
      const priceSymbols = symbols.filter(s => s.name.startsWith('P '));
      expect(priceSymbols).toHaveLength(2);
    });

    test('mixed file has price directive symbols alongside others', () => {
      const { doc, parsed } = parseDoc([
        'P 2024-01-01 EUR $1.10',
        '',
        '2024-01-15 Groceries',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n'));
      const symbols = symbolProvider.provideDocumentSymbols(doc, parsed);
      const priceSymbols = symbols.filter(s => s.kind === SymbolKind.Constant);
      const txSymbols = symbols.filter(s => s.kind === SymbolKind.Event);
      expect(priceSymbols).toHaveLength(1);
      expect(txSymbols).toHaveLength(1);
    });
  });

  describe('Find References', () => {
    const refsProvider = new FindReferencesProvider();
    const URI = require('vscode-uri').URI;

    test('finds commodity references in price directives (base commodity)', () => {
      const { doc, parsed } = parseDoc([
        'commodity EUR',
        'P 2024-01-01 EUR $1.10',
      ].join('\n'));
      const fileReader = (uri: any) => uri.toString() === doc.uri ? doc : null;
      const refs = refsProvider.findCommodityReferences(
        parsed, 'EUR', URI.parse('file:///test.journal'), fileReader
      );
      // Should find in both commodity directive and price directive
      expect(refs.length).toBeGreaterThanOrEqual(2);
    });

    test('finds commodity references in price directives (price commodity)', () => {
      const { doc, parsed } = parseDoc([
        'commodity $',
        'P 2024-01-01 EUR $1.10',
      ].join('\n'));
      const fileReader = (uri: any) => uri.toString() === doc.uri ? doc : null;
      const refs = refsProvider.findCommodityReferences(
        parsed, '$', URI.parse('file:///test.journal'), fileReader
      );
      // Should find in both commodity directive and price directive amount
      expect(refs.length).toBeGreaterThanOrEqual(2);
    });

    test('finds both commodities when same commodity is base and price', () => {
      const { doc, parsed } = parseDoc([
        'P 2024-01-01 EUR $1.10',
        'P 2024-01-01 GBP 1.20 EUR',
      ].join('\n'));
      const fileReader = (uri: any) => uri.toString() === doc.uri ? doc : null;
      const refs = refsProvider.findCommodityReferences(
        parsed, 'EUR', URI.parse('file:///test.journal'), fileReader
      );
      // EUR appears as base in first price directive and as price commodity in second
      expect(refs).toHaveLength(2);
    });
  });

  describe('Validation (undeclared commodities)', () => {
    const validator = new Validator();

    test('undeclared base commodity in price directive is flagged', () => {
      const { doc, parsed } = parseDoc([
        'commodity $',
        '',
        'P 2024-01-01 EUR $1.10',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { undeclaredCommodities: true } }
      });
      const undeclared = result.diagnostics.filter(d =>
        d.message.includes('EUR') && d.code === 'undeclared-commodity'
      );
      expect(undeclared).toHaveLength(1);
    });

    test('undeclared price commodity in price directive is flagged', () => {
      const { doc, parsed } = parseDoc([
        'commodity EUR',
        '',
        'P 2024-01-01 EUR 1.10 USD',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { undeclaredCommodities: true } }
      });
      const undeclared = result.diagnostics.filter(d =>
        d.message.includes('USD') && d.code === 'undeclared-commodity'
      );
      expect(undeclared).toHaveLength(1);
    });

    test('no false positives when commodities are declared', () => {
      const { doc, parsed } = parseDoc([
        'commodity EUR',
        'commodity $',
        '',
        'P 2024-01-01 EUR $1.10',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { undeclaredCommodities: true, undeclaredAccounts: false, undeclaredPayees: false, undeclaredTags: false } }
      });
      const commodityErrors = result.diagnostics.filter(d => d.code === 'undeclared-commodity');
      expect(commodityErrors).toHaveLength(0);
    });
  });

  describe('Hover', () => {
    const hoverProvider = new HoverProvider();

    test('commodity hover includes price history', () => {
      const content = [
        'commodity EUR',
        '',
        'P 2024-01-01 EUR $1.10',
        'P 2024-06-01 EUR $1.08',
        'P 2024-12-01 EUR $1.12',
        '',
        '2024-01-15 Exchange',
        '    assets:bank    100 EUR',
        '    assets:checking',
      ].join('\n');
      const { doc, parsed } = parseDoc(content);
      // Hover over EUR on the posting line (EUR starts at char 23)
      const hover = hoverProvider.provideHover(doc, 7, 24, parsed);
      expect(hover).not.toBeNull();
      const value = (hover!.contents as any).value;
      expect(value).toContain('Prices:');
      expect(value).toContain('3 entries');
      expect(value).toContain('2024-01-01');
      expect(value).toContain('2024-12-01');
    });

    test('commodity hover with single price entry', () => {
      const content = [
        'commodity EUR',
        '',
        'P 2024-01-01 EUR $1.10',
        '',
        '2024-01-15 Exchange',
        '    assets:bank    100 EUR',
        '    assets:checking',
      ].join('\n');
      const { doc, parsed } = parseDoc(content);
      // EUR starts at char 23 in "    assets:bank    100 EUR"
      const hover = hoverProvider.provideHover(doc, 5, 24, parsed);
      expect(hover).not.toBeNull();
      const value = (hover!.contents as any).value;
      expect(value).toContain('Prices:');
      expect(value).toContain('1 entry');
    });

    test('commodity hover without prices has no price section', () => {
      const content = [
        'commodity $',
        '',
        '2024-01-15 Test',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n');
      const { doc, parsed } = parseDoc(content);
      const hover = hoverProvider.provideHover(doc, 3, 22, parsed);
      // Should still produce hover but without price section
      if (hover) {
        const value = (hover.contents as any).value;
        expect(value).not.toContain('Prices:');
      }
    });
  });

  describe('Completion', () => {
    const completionProvider = new CompletionProvider();

    test('P appears in directive completions', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const items = completionProvider.getCompletionItems(doc, { line: 0, character: 0 });
      const pItem = items.find(i => i.label === 'P');
      expect(pItem).toBeDefined();
      expect(pItem!.detail).toContain('price');
    });

    test('commodities are suggested on P lines', () => {
      completionProvider.updateCommodities([
        { name: 'EUR', declared: true },
        { name: '$', declared: true },
      ]);
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, 'P 2024-01-01 ');
      const items = completionProvider.getCompletionItems(doc, { line: 0, character: 13 });
      const eurItem = items.find(i => i.label === 'EUR');
      expect(eurItem).toBeDefined();
    });
  });
});
