import { URI } from 'vscode-uri';
import { InlayHintsProvider } from '../../src/features/inlayHints';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range } from 'vscode-languageserver';
import { ParsedDocument } from '../../src/types';

describe('InlayHintsProvider URI Encoding - Comprehensive Tests', () => {
    let provider: InlayHintsProvider;

    beforeEach(() => {
        provider = new InlayHintsProvider();
    });

    test('should display inferred amount hints with @ in path (original Google Drive bug)', () => {
        // Reproduces the exact original issue: file in ~/Insync/patrick@gmail.com/Google Drive/
        // VSCode encodes @ as %40, spaces as %20
        const encodedUri = URI.parse('file:///home/patrick/Insync/patrick%40gmail.com/Google%20Drive/hledger-test/main.journal');
        const decodedUri = URI.parse('file:///home/patrick/Insync/patrick@gmail.com/Google%20Drive/hledger-test/main.journal');

        const content = `2024-01-15 * Test
    expenses:food  $10
    assets:cash`;

        const doc = TextDocument.create(encodedUri.toString(), 'hledger', 1, content);

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
                sourceUri: decodedUri,
                line: 0
            }],
            accounts: new Map([
                ['expenses:food', { name: 'expenses:food', declared: false }],
                ['assets:cash', { name: 'assets:cash', declared: false }]
            ]),
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

        // Should return 1 hint for the inferred amount on assets:cash
        expect(hints).toHaveLength(1);
    });

    test('should display running balance hints with multiple special characters in path', () => {
        // Test with spaces, parentheses, and @ all in the path
        const encodedUri = URI.parse('file:///home/user/My%20Finances%20(2025)/patrick%40email.com/ledger.journal');
        const decodedUri = URI.parse('file:///home/user/My%20Finances%20(2025)/patrick@email.com/ledger.journal');

        const content = `2024-01-15 * Deposit
    assets:checking       $100
    assets:savings`;

        const doc = TextDocument.create(encodedUri.toString(), 'hledger', 1, content);

        const parsed: ParsedDocument = {
            transactions: [{
                date: '2024-01-15',
                description: 'Deposit',
                payee: 'Deposit',
                note: '',
                postings: [
                    { account: 'assets:checking', amount: { quantity: 100, commodity: '$' } },
                    { account: 'assets:savings', amount: { quantity: -100, commodity: '$', inferred: true } }
                ],
                sourceUri: decodedUri,
                line: 0
            }],
            accounts: new Map([
                ['assets:checking', { name: 'assets:checking', declared: false }],
                ['assets:savings', { name: 'assets:savings', declared: false }]
            ]),
            commodities: new Map([['$', { name: '$', declared: false }]]),
            payees: new Map([['Deposit', { name: 'Deposit', declared: false }]]),
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
                    showInferredAmounts: false,
                    showRunningBalances: true,
                    showCostConversions: false
                }
            } as any
        );

        // Should return 2 hints: running balance for each posting (no assertion, so hints should appear)
        expect(hints).toHaveLength(2);
    });

    test('should handle both inferred amounts and running balances with encoded URI', () => {
        // Combined: both inferred amounts and running balances with special chars
        const encodedUri = URI.parse('file:///home/user/patrick%40gmail.com/transactions.journal');
        const decodedUri = URI.parse('file:///home/user/patrick@gmail.com/transactions.journal');

        const content = `2024-01-15 * Test
    expenses:food  $10
    assets:cash`;

        const doc = TextDocument.create(encodedUri.toString(), 'hledger', 1, content);

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
                sourceUri: decodedUri,
                line: 0
            }],
            accounts: new Map([
                ['expenses:food', { name: 'expenses:food', declared: false }],
                ['assets:cash', { name: 'assets:cash', declared: false }]
            ]),
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
                    showRunningBalances: true,
                    showCostConversions: false
                }
            } as any
        );

        // Should return 3 hints: 1 inferred amount + 2 running balances
        expect(hints.length).toBeGreaterThanOrEqual(3);
    });

    test('should filter transactions by URI even with multiple transactions', () => {
        // Test that we only show hints for transactions in the current document
        // when there are multiple transactions with different sourceUri values
        const encodedUri = URI.parse('file:///home/user/patrick%40gmail.com/main.journal');
        const decodedUri = URI.parse('file:///home/user/patrick@gmail.com/main.journal');
        const otherUri = URI.parse('file:///home/user/patrick@gmail.com/other.journal');

        const content = `2024-01-15 * Tx1
    assets:a  $10
    assets:b

2024-01-16 * Tx2
    assets:c  $20
    assets:d`;

        const doc = TextDocument.create(encodedUri.toString(), 'hledger', 1, content);

        const parsed: ParsedDocument = {
            transactions: [
                {
                    date: '2024-01-15',
                    description: 'Tx1',
                    payee: 'Tx1',
                    note: '',
                    postings: [
                        { account: 'assets:a', amount: { quantity: 10, commodity: '$' } },
                        { account: 'assets:b', amount: { quantity: -10, commodity: '$', inferred: true } }
                    ],
                    sourceUri: decodedUri, // matches current doc
                    line: 0
                },
                {
                    date: '2024-01-16',
                    description: 'Tx2',
                    payee: 'Tx2',
                    note: '',
                    postings: [
                        { account: 'assets:c', amount: { quantity: 20, commodity: '$' } },
                        { account: 'assets:d', amount: { quantity: -20, commodity: '$', inferred: true } }
                    ],
                    sourceUri: otherUri, // different document - should NOT be included
                    line: 4
                }
            ],
            accounts: new Map([
                ['assets:a', { name: 'assets:a', declared: false }],
                ['assets:b', { name: 'assets:b', declared: false }],
                ['assets:c', { name: 'assets:c', declared: false }],
                ['assets:d', { name: 'assets:d', declared: false }]
            ]),
            commodities: new Map([['$', { name: '$', declared: false }]]),
            payees: new Map([
                ['Tx1', { name: 'Tx1', declared: false }],
                ['Tx2', { name: 'Tx2', declared: false }]
            ]),
            tags: new Map(),
            directives: []
        };

        const range = Range.create(0, 0, 10, 0);

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

        // Should return only 1 hint (for Tx1 in the current doc), not 2
        expect(hints).toHaveLength(1);
    });
});
