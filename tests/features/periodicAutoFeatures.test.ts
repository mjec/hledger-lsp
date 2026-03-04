import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';
import { Validator } from '../../src/features/validator';
import { FormattingProvider } from '../../src/features/formatter';
import { SemanticTokensProvider, TokenType } from '../../src/features/semanticTokens';
import { DocumentSymbolProvider } from '../../src/features/symbols';
import { InlayHintsProvider } from '../../src/features/inlayHints';
import { FoldingRangesProvider } from '../../src/features/foldingRanges';
import { FindReferencesProvider } from '../../src/features/findReferences';
import { Range, SymbolKind } from 'vscode-languageserver';
import { ParsedDocument } from '../../src/types';

function parseDoc(content: string) {
  const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
  const parser = new HledgerParser();
  const parsed = parser.parse(doc);
  return { doc, parsed };
}

describe('Periodic/Auto Feature Integration', () => {

  describe('Validator', () => {
    const validator = new Validator();

    test('balanced periodic transaction produces no balance errors', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking  $-1500',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { balance: true } }
      });
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('unbalanced periodic transaction produces balance error', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking  $-1000',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { balance: true } }
      });
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(1);
    });

    test('periodic transaction with one missing amount is OK (inferred)', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { balance: true, missingAmounts: true, undeclaredAccounts: false, undeclaredCommodities: false, undeclaredPayees: false, undeclaredTags: false } }
      });
      expect(result.diagnostics).toHaveLength(0);
    });

    test('periodic transaction with two missing amounts produces error', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent',
        '    assets:checking',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { missingAmounts: true } }
      });
      const missingErrors = result.diagnostics.filter(d => d.message.includes('postings without amounts'));
      expect(missingErrors).toHaveLength(1);
    });

    test('empty periodic transaction produces warning', () => {
      const { doc, parsed } = parseDoc('~ monthly\n');
      const result = validator.validate(doc, parsed, {
        settings: { validation: { emptyTransactions: true } }
      });
      const emptyWarnings = result.diagnostics.filter(d => d.message.includes('no postings'));
      expect(emptyWarnings).toHaveLength(1);
    });

    test('auto posting produces no balance errors (partial by design)', () => {
      const { doc, parsed } = parseDoc([
        '= expenses:food',
        '    budget:food  *-1',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { balance: true } }
      });
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('undeclared account in periodic transaction posting is flagged', () => {
      const { doc, parsed } = parseDoc([
        'account assets:checking',
        '',
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { undeclaredAccounts: true } }
      });
      const undeclared = result.diagnostics.filter(d => d.message.includes('expenses:rent'));
      expect(undeclared).toHaveLength(1);
    });

    test('undeclared account in auto posting entry is flagged', () => {
      const { doc, parsed } = parseDoc([
        'account assets:checking',
        '',
        '= expenses:food',
        '    budget:food  *-1',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { undeclaredAccounts: true } }
      });
      const undeclared = result.diagnostics.filter(d => d.message.includes('budget:food'));
      expect(undeclared).toHaveLength(1);
    });

    test('no false positives for periodic with declared accounts', () => {
      const { doc, parsed } = parseDoc([
        'account expenses:rent',
        'account assets:checking',
        'commodity $',
        '',
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const result = validator.validate(doc, parsed, {
        settings: { validation: { undeclaredAccounts: true, undeclaredCommodities: true, balance: true, missingAmounts: true } }
      });
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Formatter', () => {
    const formatter = new FormattingProvider();

    test('periodic transaction postings get aligned', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const edits = formatter.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });
      expect(edits).toHaveLength(1);
      // The output should have formatted/aligned postings
      const formatted = edits[0].newText;
      expect(formatted).toContain('~ monthly');
      expect(formatted).toContain('expenses:rent');
    });

    test('auto posting postings get aligned', () => {
      const { doc, parsed } = parseDoc([
        '= expenses:food',
        '    budget:food    $50',
        '    assets:checking  $-50',
      ].join('\n'));
      const edits = formatter.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });
      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      expect(formatted).toContain('= expenses:food');
      expect(formatted).toContain('budget:food');
    });

    test('periodic transaction header preserved', () => {
      const { doc, parsed } = parseDoc([
        '~ every 2 months  in 2023, we will review',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const edits = formatter.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });
      const formatted = edits[0].newText;
      expect(formatted).toContain('~ every 2 months  in 2023, we will review');
    });

    test('mixed file formatting works correctly', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
        '',
        '= expenses:food',
        '    budget:food  *-1',
        '',
        '2024-01-01 Test',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n'));
      const edits = formatter.formatDocument(doc, parsed, { tabSize: 2, insertSpaces: true });
      expect(edits).toHaveLength(1);
      const formatted = edits[0].newText;
      expect(formatted).toContain('~ monthly');
      expect(formatted).toContain('= expenses:food');
      expect(formatted).toContain('2024-01-01 Test');
    });
  });

  describe('Semantic Tokens', () => {
    const provider = new SemanticTokensProvider();

    // Tokens are encoded as delta arrays: [deltaLine, deltaChar, length, tokenType, modifiers]
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

    test('~ is tokenized as operator', () => {
      const tokens = getTokens('~ monthly\n    expenses:rent    $1500\n');
      const tildeToken = tokens.find(t => t.line === 0 && t.char === 0 && t.type === TokenType.operator);
      expect(tildeToken).toBeDefined();
      expect(tildeToken!.length).toBe(1);
    });

    test('period expression is tokenized as string', () => {
      const tokens = getTokens('~ monthly\n');
      const stringToken = tokens.find(t => t.line === 0 && t.type === TokenType.string);
      expect(stringToken).toBeDefined();
    });

    test('= is tokenized as operator', () => {
      const tokens = getTokens('= expenses:food\n    budget:food  *-1\n');
      const equalsToken = tokens.find(t => t.line === 0 && t.char === 0 && t.type === TokenType.operator);
      expect(equalsToken).toBeDefined();
      expect(equalsToken!.length).toBe(1);
    });

    test('query after = is tokenized as namespace', () => {
      const tokens = getTokens('= expenses:food\n');
      const nsToken = tokens.find(t => t.line === 0 && t.type === TokenType.namespace);
      expect(nsToken).toBeDefined();
    });

    test('postings under periodic transaction are tokenized', () => {
      const tokens = getTokens('~ monthly\n    expenses:rent    $1500\n');
      const accountToken = tokens.find(t => t.line === 1 && t.type === TokenType.namespace);
      expect(accountToken).toBeDefined();
    });
  });

  describe('Document Symbols', () => {
    const symbolProvider = new DocumentSymbolProvider();

    test('periodic transaction appears in symbols with ~ prefix', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const symbols = symbolProvider.provideDocumentSymbols(doc, parsed);
      const periodicSymbol = symbols.find(s => s.name.startsWith('~'));
      expect(periodicSymbol).toBeDefined();
      expect(periodicSymbol!.name).toContain('monthly');
      expect(periodicSymbol!.kind).toBe(SymbolKind.Event);
    });

    test('auto posting appears in symbols with = prefix', () => {
      const { doc, parsed } = parseDoc([
        '= expenses:food',
        '    budget:food  *-1',
      ].join('\n'));
      const symbols = symbolProvider.provideDocumentSymbols(doc, parsed);
      const autoSymbol = symbols.find(s => s.name.startsWith('='));
      expect(autoSymbol).toBeDefined();
      expect(autoSymbol!.name).toContain('expenses:food');
      expect(autoSymbol!.kind).toBe(SymbolKind.Interface);
    });

    test('periodic transaction has children for postings', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const symbols = symbolProvider.provideDocumentSymbols(doc, parsed);
      const periodicSymbol = symbols.find(s => s.name.startsWith('~'));
      expect(periodicSymbol?.children).toBeDefined();
      expect(periodicSymbol!.children!.length).toBe(2);
    });

    test('mixed file has all symbol types', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
        '',
        '= expenses:food',
        '    budget:food  *-1',
        '',
        '2024-01-01 Test',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n'));
      const symbols = symbolProvider.provideDocumentSymbols(doc, parsed);
      const periodic = symbols.filter(s => s.name.startsWith('~'));
      const auto = symbols.filter(s => s.name.startsWith('='));
      const transactions = symbols.filter(s => s.kind === SymbolKind.Event && !s.name.startsWith('~'));
      expect(periodic).toHaveLength(1);
      expect(auto).toHaveLength(1);
      expect(transactions).toHaveLength(1);
    });
  });

  describe('Folding Ranges', () => {
    const foldingProvider = new FoldingRangesProvider();

    test('periodic transaction block can be folded', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const ranges = foldingProvider.provideFoldingRanges(doc, parsed);
      const periodicRange = ranges.find(r => r.startLine === 0);
      expect(periodicRange).toBeDefined();
      expect(periodicRange!.endLine).toBe(2);
    });

    test('auto posting block can be folded', () => {
      const { doc, parsed } = parseDoc([
        '= expenses:food',
        '    budget:food  *-1',
        '    assets:checking  *1',
      ].join('\n'));
      const ranges = foldingProvider.provideFoldingRanges(doc, parsed);
      const autoRange = ranges.find(r => r.startLine === 0);
      expect(autoRange).toBeDefined();
      expect(autoRange!.endLine).toBe(2);
    });

    test('mixed file has correct folding ranges', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
        '',
        '= expenses:food',
        '    budget:food  *-1',
        '',
        '2024-01-01 Test',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n'));
      const ranges = foldingProvider.provideFoldingRanges(doc, parsed);
      expect(ranges.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Find References', () => {
    const refsProvider = new FindReferencesProvider();

    test('finds account references in periodic transaction postings', () => {
      const { doc, parsed } = parseDoc([
        'account expenses:rent',
        '',
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const URI = require('vscode-uri').URI;
      const fileReader = (uri: any) => uri.toString() === doc.uri ? doc : null;
      const refs = refsProvider.findAccountReferences(
        parsed, 'expenses:rent',
        URI.parse('file:///test.journal'),
        fileReader
      );
      // Should find in both directive and periodic posting
      expect(refs.length).toBeGreaterThanOrEqual(2);
    });

    test('finds account references in auto posting entries', () => {
      const { doc, parsed } = parseDoc([
        'account budget:food',
        '',
        '= expenses:food',
        '    budget:food  *-1',
      ].join('\n'));
      const URI = require('vscode-uri').URI;
      const fileReader = (uri: any) => uri.toString() === doc.uri ? doc : null;
      const refs = refsProvider.findAccountReferences(
        parsed, 'budget:food',
        URI.parse('file:///test.journal'),
        fileReader
      );
      expect(refs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Inlay Hints', () => {
    const hintsProvider = new InlayHintsProvider();

    test('shows inferred amounts for periodic transaction postings', () => {
      const { doc, parsed } = parseDoc([
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n'));
      const hints = hintsProvider.provideInlayHints(
        doc,
        Range.create(0, 0, 10, 0),
        parsed,
        { inlayHints: { showInferredAmounts: true, showCostConversions: false, showRunningBalances: false } } as any
      );
      // Should have at least one hint for the inferred amount on assets:checking
      const amountHints = hints.filter(h => {
        const label = typeof h.label === 'string' ? h.label : h.label[0]?.value;
        return label && label.includes('1500');
      });
      expect(amountHints.length).toBeGreaterThanOrEqual(1);
    });
  });
});
