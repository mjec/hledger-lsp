import { TextDocument } from 'vscode-languageserver-textdocument';
import { semanticTokensProvider, TokenType, TokenModifier, tokenTypes, tokenModifiers } from '../../src/features/semanticTokens';
import { HledgerParser } from '../../src/parser/index';

describe('SemanticTokensProvider', () => {
  const parser = new HledgerParser();

  /**
   * Helper to decode semantic tokens for easier testing
   */
  function decodeTokens(data: number[]): Array<{
    line: number;
    char: number;
    length: number;
    tokenType: string;
    modifiers: string[];
  }> {
    const tokens: Array<{
      line: number;
      char: number;
      length: number;
      tokenType: string;
      modifiers: string[];
    }> = [];

    let line = 0;
    let char = 0;

    for (let i = 0; i < data.length; i += 5) {
      const deltaLine = data[i];
      const deltaChar = data[i + 1];
      const length = data[i + 2];
      const tokenTypeIdx = data[i + 3];
      const modifierBits = data[i + 4];

      // Update position
      line += deltaLine;
      if (deltaLine === 0) {
        char += deltaChar;
      } else {
        char = deltaChar;
      }

      // Decode modifiers
      const mods: string[] = [];
      for (let j = 0; j < tokenModifiers.length; j++) {
        if (modifierBits & (1 << j)) {
          mods.push(tokenModifiers[j]);
        }
      }

      tokens.push({
        line,
        char,
        length,
        tokenType: tokenTypes[tokenTypeIdx],
        modifiers: mods
      });
    }

    return tokens;
  }

  describe('token types and modifiers', () => {
    test('should export token types array', () => {
      expect(tokenTypes).toBeDefined();
      expect(tokenTypes.length).toBeGreaterThan(0);
      expect(tokenTypes).toContain('namespace');
      expect(tokenTypes).toContain('keyword');
    });

    test('should export token modifiers array', () => {
      expect(tokenModifiers).toBeDefined();
      expect(tokenModifiers.length).toBeGreaterThan(0);
      expect(tokenModifiers).toContain('declaration');
      expect(tokenModifiers).toContain('readonly');
    });
  });

  describe('provideSemanticTokens', () => {
    test('should return empty array for empty document', () => {
      const content = '';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);

      expect(data).toEqual([]);
    });

    test('should tokenize transaction date', () => {
      const content = `2023-01-15 Test Transaction
  Assets:Bank  $100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find date token
      const dateToken = tokens.find(t => t.tokenType === 'type');
      expect(dateToken).toBeDefined();
      expect(dateToken!.line).toBe(0);
      expect(dateToken!.char).toBe(0);
      expect(dateToken!.length).toBe(10); // Length of "2023-01-15"
      expect(dateToken!.modifiers).toContain('readonly');
    });

    test('should tokenize transaction status', () => {
      const content = `2023-01-15 * Test Transaction
  Assets:Bank  $100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find status token
      const statusToken = tokens.find(t => t.tokenType === 'operator');
      expect(statusToken).toBeDefined();
      expect(statusToken!.line).toBe(0);
      expect(statusToken!.length).toBe(1);
    });

    test('should tokenize transaction code', () => {
      const content = `2023-01-15 (CHK001) Test Transaction
  Assets:Bank  $100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find code token
      const codeToken = tokens.find(t => t.tokenType === 'string');
      expect(codeToken).toBeDefined();
      expect(codeToken!.line).toBe(0);
      expect(codeToken!.length).toBe(8); // Length of "(CHK001)"
    });

    test('should tokenize payee', () => {
      const content = `2023-01-15 Test Payee
  Assets:Bank  $100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find payee token
      const payeeToken = tokens.find(t => t.tokenType === 'class');
      expect(payeeToken).toBeDefined();
      expect(payeeToken!.line).toBe(0);
      expect(payeeToken!.length).toBe(10); // Length of "Test Payee"
    });

    test('should tokenize account names', () => {
      const content = `2023-01-15 Test
  Assets:Bank:Checking  $100.00
  Expenses:Food
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find account tokens
      const accountTokens = tokens.filter(t => t.tokenType === 'namespace');
      expect(accountTokens.length).toBe(2);
      expect(accountTokens[0].line).toBe(1);
      expect(accountTokens[1].line).toBe(2);
    });

    test('should tokenize amounts with commodity-first format', () => {
      const content = `2023-01-15 Test
  Assets:Bank  $100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find commodity token
      const commodityToken = tokens.find(t => t.tokenType === 'enum');
      expect(commodityToken).toBeDefined();
      expect(commodityToken!.line).toBe(1);

      // Find number token
      const numberToken = tokens.find(t => t.tokenType === 'number');
      expect(numberToken).toBeDefined();
      expect(numberToken!.line).toBe(1);
      expect(numberToken!.modifiers).toContain('readonly');
    });

    test('should tokenize amounts with commodity-after format', () => {
      const content = `2023-01-15 Test
  Assets:Bank  100.00 USD
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find commodity token
      const commodityToken = tokens.find(t => t.tokenType === 'enum');
      expect(commodityToken).toBeDefined();
      expect(commodityToken!.line).toBe(1);

      // Find number token
      const numberToken = tokens.find(t => t.tokenType === 'number');
      expect(numberToken).toBeDefined();
      expect(numberToken!.line).toBe(1);
    });

    test('should tokenize comments', () => {
      const content = `; This is a comment
2023-01-15 Test
  Assets:Bank  $100.00  ; posting comment
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find comment tokens
      const commentTokens = tokens.filter(t => t.tokenType === 'comment');
      expect(commentTokens.length).toBeGreaterThan(0);
    });

    test('should tokenize tags in comments', () => {
      const content = `2023-01-15 Test ; project:alpha status:pending
  Assets:Bank  $100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find tag tokens
      const tagTokens = tokens.filter(t => t.tokenType === 'property');
      expect(tagTokens.length).toBe(2); // project and status
    });

    test('should tokenize account directive', () => {
      const content = `account Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find keyword token
      const keywordToken = tokens.find(t => t.tokenType === 'keyword');
      expect(keywordToken).toBeDefined();
      expect(keywordToken!.line).toBe(0);
      expect(keywordToken!.char).toBe(0);
      expect(keywordToken!.length).toBe(7); // Length of "account"

      // Find account declaration token
      const accountToken = tokens.find(t => t.tokenType === 'namespace' && t.modifiers.includes('declaration'));
      expect(accountToken).toBeDefined();
      expect(accountToken!.line).toBe(0);
    });

    test('should tokenize payee directive', () => {
      const content = `payee Test Payee
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find keyword token
      const keywordToken = tokens.find(t => t.tokenType === 'keyword');
      expect(keywordToken).toBeDefined();

      // Find payee declaration token
      const payeeToken = tokens.find(t => t.tokenType === 'class' && t.modifiers.includes('declaration'));
      expect(payeeToken).toBeDefined();
    });

    test('should tokenize commodity directive', () => {
      const content = `commodity $1.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find keyword token
      const keywordToken = tokens.find(t => t.tokenType === 'keyword');
      expect(keywordToken).toBeDefined();

      // Find commodity declaration token
      const commodityToken = tokens.find(t => t.tokenType === 'enum' && t.modifiers.includes('declaration'));
      expect(commodityToken).toBeDefined();
    });

    test('should tokenize tag directive', () => {
      const content = `tag project
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find keyword token
      const keywordToken = tokens.find(t => t.tokenType === 'keyword');
      expect(keywordToken).toBeDefined();

      // Find tag declaration token
      const tagToken = tokens.find(t => t.tokenType === 'property' && t.modifiers.includes('declaration'));
      expect(tagToken).toBeDefined();
    });

    test('should handle complex document with multiple features', () => {
      const content = `; Journal for testing
account Assets:Bank
commodity $1.00
payee Grocery Store
tag project

2023-01-15 * (001) Grocery Store ; project:alpha
  Assets:Bank  $-50.00
  Expenses:Food  $50.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Should have various token types
      expect(tokens.some(t => t.tokenType === 'keyword')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'namespace')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'class')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'enum')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'property')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'type')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'number')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'comment')).toBe(true);
    });

    test('should handle negative amounts', () => {
      const content = `2023-01-15 Test
  Assets:Bank  $-100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find number token (should include negative sign)
      const numberToken = tokens.find(t => t.tokenType === 'number');
      expect(numberToken).toBeDefined();
    });

    test('should handle postings without amounts', () => {
      const content = `2023-01-15 Test
  Assets:Bank  $100.00
  Expenses:Food
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Should have account tokens for both postings
      const accountTokens = tokens.filter(t => t.tokenType === 'namespace');
      expect(accountTokens.length).toBe(2);
    });

    test('should handle directive with comment', () => {
      const content = `account Assets:Bank  ; Main checking account
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Should have keyword, account declaration, and comment tokens
      expect(tokens.some(t => t.tokenType === 'keyword')).toBe(true);
      expect(tokens.some(t => t.tokenType === 'namespace' && t.modifiers.includes('declaration'))).toBe(true);
      expect(tokens.some(t => t.tokenType === 'comment')).toBe(true);
    });

    test('should correctly tokenize transaction header with tags in comment', () => {
      const content = `2024-01-25 * Restaurant ; trip:vacation, category:dining
  Expenses:Dining  $50.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Check that we have the expected tokens on line 0
      const line0Tokens = tokens.filter(t => t.line === 0);

      // Should have date token
      const dateToken = line0Tokens.find(t => t.tokenType === 'type');
      expect(dateToken).toBeDefined();
      expect(dateToken!.char).toBe(0);
      expect(dateToken!.length).toBe(10);

      // Should have status token
      const statusToken = line0Tokens.find(t => t.tokenType === 'operator');
      expect(statusToken).toBeDefined();
      expect(statusToken!.char).toBe(11);

      // Should have payee token
      const payeeToken = line0Tokens.find(t => t.tokenType === 'class');
      expect(payeeToken).toBeDefined();
      expect(payeeToken!.char).toBe(13);
      expect(payeeToken!.length).toBe(10); // "Restaurant"

      // Should have tag tokens - "trip" and "category"
      const tagTokens = line0Tokens.filter(t => t.tokenType === 'property');
      expect(tagTokens.length).toBe(2);

      // First tag: "trip" at position 27
      const tripTag = tagTokens.find(t => t.char === 26);
      expect(tripTag).toBeDefined();
      expect(tripTag!.length).toBe(4); // "trip"

      // Second tag: "category" at position 41
      const categoryTag = tagTokens.find(t => t.char === 41);
      expect(categoryTag).toBeDefined();
      expect(categoryTag!.length).toBe(8); // "category"

      // Should have comment tokens for the rest
      const commentTokens = line0Tokens.filter(t => t.tokenType === 'comment');
      expect(commentTokens.length).toBeGreaterThan(0);
    });

    test('should tokenize cost notation with @ (unit cost)', () => {
      const content = `2023-01-15 Test
  Assets:EUR  €100 @ $1.35
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find @ operator token
      const operatorTokens = tokens.filter(t => t.tokenType === 'operator' && t.line === 1);
      expect(operatorTokens.length).toBeGreaterThan(0);

      // Should have commodity tokens for both EUR and USD
      const commodityTokens = tokens.filter(t => t.tokenType === 'enum' && t.line === 1);
      expect(commodityTokens.length).toBe(2);

      // Should have number tokens for both amounts
      const numberTokens = tokens.filter(t => t.tokenType === 'number' && t.line === 1);
      expect(numberTokens.length).toBe(2);
    });

    test('should tokenize cost notation with @@ (total cost)', () => {
      const content = `2023-01-15 Test
  Assets:EUR  €100 @@ $135
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find @@ operator token
      const operatorTokens = tokens.filter(t => t.tokenType === 'operator' && t.line === 1);
      expect(operatorTokens.length).toBeGreaterThan(0);

      // Should have commodity tokens for both EUR and USD
      const commodityTokens = tokens.filter(t => t.tokenType === 'enum' && t.line === 1);
      expect(commodityTokens.length).toBe(2);

      // Should have number tokens for both amounts
      const numberTokens = tokens.filter(t => t.tokenType === 'number' && t.line === 1);
      expect(numberTokens.length).toBe(2);
    });

    test('should tokenize cost with balance assertion', () => {
      const content = `2023-01-15 Test
  Assets:EUR  €100 @ $1.35 = €100
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // Find operator tokens (@ and =)
      const operatorTokens = tokens.filter(t => t.tokenType === 'operator' && t.line === 1);
      expect(operatorTokens.length).toBe(2); // @ and =

      // Should have commodity tokens (€ appears twice, $ once)
      const commodityTokens = tokens.filter(t => t.tokenType === 'enum' && t.line === 1);
      expect(commodityTokens.length).toBe(3);

      // Should have number tokens (100, 1.35, 100)
      const numberTokens = tokens.filter(t => t.tokenType === 'number' && t.line === 1);
      expect(numberTokens.length).toBe(3);
    });

    it('should tokenize amounts with unusual number formats (spaces within numbers)', () => {
      const content = `2024-01-01 Test
    expenses:food    EUR 1 000 000,00
    assets:checking    -1 000 000,00 EUR
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      // First posting: EUR 1 000 000,00
      const line1Tokens = tokens.filter(t => t.line === 1);

      // Should have commodity token (EUR)
      const commodityTokens1 = line1Tokens.filter(t => t.tokenType === 'enum');
      expect(commodityTokens1.length).toBe(1);
      expect(commodityTokens1[0].length).toBe(3); // EUR

      // Should have number token (1 000 000,00 - but trimmed to remove trailing spaces)
      const numberTokens1 = line1Tokens.filter(t => t.tokenType === 'number');
      expect(numberTokens1.length).toBe(1);
      // The number should be recognized even with spaces

      // Second posting: -1 000 000,00 EUR
      const line2Tokens = tokens.filter(t => t.line === 2);

      // Should have commodity token (EUR)
      const commodityTokens2 = line2Tokens.filter(t => t.tokenType === 'enum');
      expect(commodityTokens2.length).toBe(1);
      expect(commodityTokens2[0].length).toBe(3); // EUR

      // Should have number token (-1 000 000,00)
      const numberTokens2 = line2Tokens.filter(t => t.tokenType === 'number');
      expect(numberTokens2.length).toBe(1);
    });

    it('should tokenize amounts with apostrophe separators', () => {
      const content = `2024-01-01 Test
    expenses:food    CHF 1'000'000.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const data = semanticTokensProvider.provideSemanticTokens(doc, parsed);
      const tokens = decodeTokens(data);

      const line1Tokens = tokens.filter(t => t.line === 1);

      // Should have commodity token (CHF)
      const commodityTokens = line1Tokens.filter(t => t.tokenType === 'enum');
      expect(commodityTokens.length).toBe(1);
      expect(commodityTokens[0].length).toBe(3);

      // Should have number token
      const numberTokens = line1Tokens.filter(t => t.tokenType === 'number');
      expect(numberTokens.length).toBe(1);
    });
  });
});
