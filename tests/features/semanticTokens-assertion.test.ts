/**
 * Tests for semantic token highlighting of balance assertions
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { semanticTokensProvider, tokenTypes, tokenModifiers } from '../../src/features/semanticTokens';

describe('Semantic Tokens - Balance Assertions', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  /**
   * Helper to decode semantic tokens into human-readable format
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
      const tokenTypeIndex = data[i + 3];
      const tokenModifiersBitset = data[i + 4];

      line += deltaLine;
      if (deltaLine === 0) {
        char += deltaChar;
      } else {
        char = deltaChar;
      }

      const modifiers: string[] = [];
      for (let j = 0; j < tokenModifiers.length; j++) {
        if ((tokenModifiersBitset & (1 << j)) !== 0) {
          modifiers.push(tokenModifiers[j]);
        }
      }

      tokens.push({
        line,
        char,
        length,
        tokenType: tokenTypes[tokenTypeIndex],
        modifiers
      });
    }

    return tokens;
  }

  test('should tokenize balance assertion with integer amount', () => {
    const content = `
2024-01-01 Test
    assets:checking   $100 = $1000
    expenses:food     $-100
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const data = semanticTokensProvider.provideSemanticTokens(doc);
    const tokens = decodeTokens(data);

    // Find tokens on line 2 (the first posting with balance assertion)
    const line2Tokens = tokens.filter(t => t.line === 2);

    // Should have:  account, amount ($100), =, assertion ($1000)
    // Account
    const accountToken = line2Tokens.find(t => t.tokenType === 'namespace');
    expect(accountToken).toBeDefined();
    expect(accountToken!.char).toBeGreaterThanOrEqual(0);

    // Amount number (100)
    const amountTokens = line2Tokens.filter(t => t.tokenType === 'number');
    expect(amountTokens.length).toBeGreaterThanOrEqual(2); // amount and assertion

    // Equals operator
    const equalToken = line2Tokens.find(t => t.tokenType === 'operator' && t.length === 1);
    expect(equalToken).toBeDefined();

    // Assertion amount (1000)
    const assertionToken = amountTokens[amountTokens.length - 1];
    expect(assertionToken).toBeDefined();
  });

  test('should tokenize balance assertion with decimal amount', () => {
    const content = `
2024-01-01 Test
    assets:checking   $100.50 = $945.00
    expenses:food     $-100.50
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const data = semanticTokensProvider.provideSemanticTokens(doc);
    const tokens = decodeTokens(data);

    // Find tokens on line 2
    const line2Tokens = tokens.filter(t => t.line === 2);

    // Amount number tokens
    const numberTokens = line2Tokens.filter(t => t.tokenType === 'number');
    expect(numberTokens.length).toBe(2); // posting amount and assertion amount

    // First number should be "100.50" (length 6)
    const postingAmountToken = numberTokens[0];
    expect(postingAmountToken.length).toBe(6); // "100.50"

    // Second number should be "945.00" (length 6)
    const assertionAmountToken = numberTokens[1];
    expect(assertionAmountToken.length).toBe(6); // "945.00"

    // Extract the actual text to verify
    const line = content.split('\n')[2];
    const postingAmountText = line.substring(postingAmountToken.char, postingAmountToken.char + postingAmountToken.length);
    const assertionAmountText = line.substring(assertionAmountToken.char, assertionAmountToken.char + assertionAmountToken.length);


    expect(postingAmountText).toBe('100.50');
    expect(assertionAmountText).toBe('945.00');
  });

  test('should tokenize balance assertion with two decimals', () => {
    const content = `
2024-01-01 Test
    assets:checking   $50.99 = $100.25
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const data = semanticTokensProvider.provideSemanticTokens(doc);
    const tokens = decodeTokens(data);

    const line2Tokens = tokens.filter(t => t.line === 2);
    const numberTokens = line2Tokens.filter(t => t.tokenType === 'number');

    // Should have 2 number tokens
    expect(numberTokens.length).toBe(2);

    // Check lengths
    expect(numberTokens[0].length).toBe(5); // "50.99"
    expect(numberTokens[1].length).toBe(6); // "100.25"
  });


  test('should tokenize with various decimal patterns', () => {
    const content = `
2024-01-01 Test1
    assets:checking   $1.5 = $100.5
2024-01-02 Test2
    assets:savings    $1000.99 = $5000.00
2024-01-03 Test3
    assets:cash       $0.01 = $0.50
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const data = semanticTokensProvider.provideSemanticTokens(doc);
    const tokens = decodeTokens(data);

    // Line 2: $1.5 = $100.5
    const line2Numbers = tokens.filter(t => t.line === 2 && t.tokenType === 'number');
    expect(line2Numbers.length).toBe(2);
    const line2Text = content.split('\n')[2];
    expect(line2Text.substring(line2Numbers[0].char, line2Numbers[0].char + line2Numbers[0].length)).toBe('1.5');
    expect(line2Text.substring(line2Numbers[1].char, line2Numbers[1].char + line2Numbers[1].length)).toBe('100.5');

    // Line 4: $1000.99 = $5000.00
    const line4Numbers = tokens.filter(t => t.line === 4 && t.tokenType === 'number');
    expect(line4Numbers.length).toBe(2);
    const line4Text = content.split('\n')[4];
    expect(line4Text.substring(line4Numbers[0].char, line4Numbers[0].char + line4Numbers[0].length)).toBe('1000.99');
    expect(line4Text.substring(line4Numbers[1].char, line4Numbers[1].char + line4Numbers[1].length)).toBe('5000.00');

    // Line 6: $0.01 = $0.50
    const line6Numbers = tokens.filter(t => t.line === 6 && t.tokenType === 'number');
    expect(line6Numbers.length).toBe(2);
    const line6Text = content.split('\n')[6];
    expect(line6Text.substring(line6Numbers[0].char, line6Numbers[0].char + line6Numbers[0].length)).toBe('0.01');
    expect(line6Text.substring(line6Numbers[1].char, line6Numbers[1].char + line6Numbers[1].length)).toBe('0.50');
  });
});
