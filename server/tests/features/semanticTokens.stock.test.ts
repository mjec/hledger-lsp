import { SemanticTokensProvider } from '../../src/features/semanticTokens';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser/index';

describe('SemanticTokensProvider - Stock Commodities', () => {
  const provider = new SemanticTokensProvider();
  const parser = new HledgerParser();

  // Helper to decode tokens for easier testing
  function decodeTokens(data: number[]): Array<{
    line: number;
    startChar: number;
    length: number;
    tokenType: string;
    tokenModifiers: string[];
  }> {
    const tokenTypes = ['namespace', 'type', 'class', 'enum', 'property', 'keyword', 'number', 'string', 'comment', 'operator'];
    const tokenModifiers = ['declaration', 'readonly', 'deprecated'];

    const tokens: Array<{
      line: number;
      startChar: number;
      length: number;
      tokenType: string;
      tokenModifiers: string[];
    }> = [];

    let line = 0;
    let startChar = 0;

    for (let i = 0; i < data.length; i += 5) {
      const deltaLine = data[i];
      const deltaStartChar = data[i + 1];
      const length = data[i + 2];
      const tokenType = data[i + 3];
      const tokenModifiersBitset = data[i + 4];

      line += deltaLine;
      if (deltaLine !== 0) {
        startChar = 0;
      }
      startChar += deltaStartChar;

      const modifiers: string[] = [];
      for (let bit = 0; bit < tokenModifiers.length; bit++) {
        if ((tokenModifiersBitset & (1 << bit)) !== 0) {
          modifiers.push(tokenModifiers[bit]);
        }
      }

      tokens.push({
        line,
        startChar,
        length,
        tokenType: tokenTypes[tokenType] || `unknown(${tokenType})`,
        tokenModifiers: modifiers,
      });
    }

    return tokens;
  }

  test('should tokenize stock commodities like AAPL with costs', () => {
    const content = `2024-01-10 Stock Purchase
    assets:stock     10 AAPL @ $150.50
    assets:checking    $-1505.00
`;
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const data = provider.provideSemanticTokens(doc, parsed);
    const tokens = decodeTokens(data);

    const line1Tokens = tokens.filter(t => t.line === 1);

    // Find AAPL token
    const aaplToken = line1Tokens.find(t => {
      const text = content.split('\n')[t.line].substring(t.startChar, t.startChar + t.length);
      return text === 'AAPL';
    });

    // Should have commodity tokens for AAPL and $
    const commodityTokens = tokens.filter(t => t.tokenType === 'enum' && t.line === 1);

    expect(commodityTokens.length).toBe(2); // AAPL and $
    expect(aaplToken).toBeDefined();
    expect(aaplToken?.tokenType).toBe('enum');
  });

  test('should tokenize formatted stock purchase with padding', () => {
    // This is the actual formatted output from alignment-demo
    const content = `2024-01-10 Stock Purchase - Unit Costs
    assets:stock                                  10 AAPL @ $150.50
    assets:stock                                   5 MSFT @ $320.00
    assets:checking                           $-3105.00
`;
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    const data = provider.provideSemanticTokens(doc, parsed);
    const tokens = decodeTokens(data);

    const line1Tokens = tokens.filter(t => t.line === 1);
    const line2Tokens = tokens.filter(t => t.line === 2);

    // Check AAPL tokenization
    const aaplToken = line1Tokens.find(t => {
      const text = content.split('\n')[t.line].substring(t.startChar, t.startChar + t.length);
      return text === 'AAPL';
    });

    // Check MSFT tokenization
    const msftToken = line2Tokens.find(t => {
      const text = content.split('\n')[t.line].substring(t.startChar, t.startChar + t.length);
      return text === 'MSFT';
    });

    expect(aaplToken).toBeDefined();
    expect(aaplToken?.tokenType).toBe('enum');

    expect(msftToken).toBeDefined();
    expect(msftToken?.tokenType).toBe('enum');

    // Each line should have 2 commodity tokens (AAPL/MSFT and $)
    const line1Commodities = line1Tokens.filter(t => t.tokenType === 'enum');
    const line2Commodities = line2Tokens.filter(t => t.tokenType === 'enum');

    expect(line1Commodities.length).toBe(2);
    expect(line2Commodities.length).toBe(2);
  });
});
