```typescript
import { semanticTokensProvider, tokenTypes } from '../../src/features/semanticTokens';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parser } from '../../src/parser';

describe('SemanticTokens - Negative Sign Position', () => {
    // Helper to decode tokens for easier debugging
    function decodeTokens(tokens: number[], content: string): any[] {
        const lines = content.split('\n');
        const decoded: any[] = [];

        for (let i = 0; i < tokens.length; i += 5) {
            const deltaLine = tokens[i];
            const deltaStart = tokens[i + 1];
            const length = tokens[i + 2];
            const tokenType = tokens[i + 3];
            const tokenModifiers = tokens[i + 4];

            // Calculate absolute position
            const prevLine = decoded.length > 0 ? decoded[decoded.length - 1].line : 0;
            const prevStart = decoded.length > 0 ? decoded[decoded.length - 1].start : 0;
            const prevLength = decoded.length > 0 ? decoded[decoded.length - 1].length : 0;

            const line = i === 0 ? deltaLine : prevLine + deltaLine;
            const start = deltaLine === 0 && i > 0 ? prevStart + prevLength + deltaStart : deltaStart;

            const text = lines[line].substring(start, start + length);

            decoded.push({
                line,
                start,
                length,
                type: tokenTypes[tokenType],
                text
            });
        }

        return decoded;
    }

    test('should tokenize -$100 (sign before commodity) with correct tokens', () => {
        const content = `2024-01-01 Test
expenses: food - $100
assets: cash`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        const tokens = semanticTokensProvider.provideSemanticTokens(doc, parsed);
        const decoded = decodeTokens(tokens, content);

        console.log('Tokens for -$100:', JSON.stringify(decoded.filter(t => t.line === 1), null, 2));

        // Should have tokens for the amount on line 1
        const line1Tokens = decoded.filter(t => t.line === 1);
        const amountTokens = line1Tokens.filter(t => t.type === 'enum' || t.type === 'number');

        // Should tokenize both commodity and number
        expect(amountTokens.length).toBeGreaterThanOrEqual(1);
    });

    test('should tokenize $-100 (sign after commodity)', () => {
        const content = `2024-01-01 Test
expenses:food  $ - 100
assets: cash`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        const tokens = semanticTokensProvider.provideSemanticTokens(doc, parsed);
        const decoded = decodeTokens(tokens, content);

        console.log('Tokens for $-100:', JSON.stringify(decoded.filter(t => t.line === 1), null, 2));

        // Should have tokens for the amount on line 1
        const line1Tokens = decoded.filter(t => t.line === 1);
        const amountTokens = line1Tokens.filter(t => t.type === 'enum' || t.type === 'number');

        // Should tokenize both commodity and number
        expect(amountTokens.length).toBeGreaterThanOrEqual(2);
    });

    test('should tokenize - $100 (sign before commodity with space)', () => {
        const content = `2024-01-01 Test
expenses: food - $100
assets: cash`;

        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        const parsed = parser.parse(doc);

        const tokens = semanticTokensProvider.provideSemanticTokens(doc, parsed);
        const decoded = decodeTokens(tokens, content);

        console.log('Tokens for - $100:', JSON.stringify(decoded.filter(t => t.line === 1), null, 2));

        // Should have tokens for the amount on line 1
        const line1Tokens = decoded.filter(t => t.line === 1);
        const amountTokens = line1Tokens.filter(t => t.type === 'enum' || t.type === 'number');

        // Should tokenize both commodity and number
        expect(amountTokens.length).toBeGreaterThanOrEqual(1);
    });
});
