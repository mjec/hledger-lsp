import { InlayHintsProvider } from '../../src/features/inlayHints';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range } from 'vscode-languageserver';
import { ParsedDocument } from '../../src/types';

describe('InlayHintsProvider URI Encoding', () => {
    let provider: InlayHintsProvider;

    beforeEach(() => {
        provider = new InlayHintsProvider();
    });

    test('should return hints when client URI is encoded but internal URI is not', () => {
        // Case: @ is encoded by VSCode (%40) but NOT by our server (allowed char)
        // This mismatch causes the bug.
        const encodedUri = 'file:///home/user/patrick%40email.com/test.journal';
        const decodedUri = 'file:///home/user/patrick@email.com/test.journal';

        const content = `2024-01-15 * Test
    expenses:food  $10
    assets:cash`;

        // Client provides document with Encoded URI
        const doc = TextDocument.create(encodedUri, 'hledger', 1, content);

        // Parser (internal) produces transaction with Decoded URI
        const parsed: ParsedDocument = {
            transactions: [{
                date: '2024-01-15',
                description: 'Test',
                payee: 'Test',
                note: '',
                postings: [
                    { account: 'expenses:food', amount: { quantity: 10, commodity: '$' } },
                    { account: 'assets:cash', amount: { quantity: -10, commodity: '$', inferred: true } }
                ],
                sourceUri: decodedUri, // internal parser uses decoded/clean URI
                line: 0
            }],
            accounts: new Map([['expenses:food', { name: 'expenses:food', declared: false }], ['assets:cash', { name: 'assets:cash', declared: false }]]),
            commodities: new Map([['$', { name: '$', declared: false }]]),
            payees: new Map([['Test', { name: 'Test', declared: false }]]),
            tags: new Map(),
            directives: []
        };

        const range = Range.create(0, 0, 3, 0);

        const hints = provider.provideInlayHints(
            doc,
            range,
            parsed,
            {
                inlayHints: {
                    showInferredAmounts: true,
                    showRunningBalances: false,
                    showCostConversions: false
                }
            } as any
        );

        // Before fix: mismatch causes 0 hints
        // After fix: should match and return 1 hint
        expect(hints).toHaveLength(1);
    });
});
