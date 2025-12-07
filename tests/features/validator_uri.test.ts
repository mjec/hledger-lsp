import { TextDocument } from 'vscode-languageserver-textdocument';
import { Validator } from '../../src/features/validator';
import { ParsedDocument, Transaction } from '../../src/types';
import { toFileUri } from '../../src/utils/uri';

describe('Validator URI Encoding', () => {
    let validator: Validator;
    let mockDocument: TextDocument;
    let mockParsedDoc: ParsedDocument;

    const encodedUri = 'file:///home/user/patrick%40email.com/test.journal';
    const decodedUri = 'file:///home/user/patrick@email.com/test.journal';

    beforeEach(() => {
        validator = new Validator();

        // Mock document with encoded URI (as sent by VSCode)
        mockDocument = TextDocument.create(encodedUri, 'hledger', 1, '2025-01-01 Test\n    Expenses:Food    10.00 USD\n    Assets:Cash\n');

        // Mock parsed document with decoded URI (as stored internally)
        const transaction: Transaction = {
            date: '2025-01-01',
            description: 'Test',
            status: 'uncleared',
            postings: [
                { account: 'Expenses:Food', amount: { quantity: 10, commodity: 'USD' } },
                { account: 'Assets:Cash', amount: { quantity: -10, commodity: 'USD' } }
            ],
            sourceUri: decodedUri,
            line: 0,
            range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
            headerRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 15 } }
        } as unknown as Transaction;

        mockParsedDoc = {
            transactions: [transaction],
            accounts: new Map([['Expenses:Food', { name: 'Expenses:Food', declared: false, sourceUri: decodedUri } as any]]),
            commodities: new Map(),
            payees: new Map(),
            tags: new Map(),
            directives: []
        } as unknown as ParsedDocument;
    });

    it('should validate transactions when sourceUri is decoded but document.uri is encoded', () => {
        const result = validator.validate(mockDocument, mockParsedDoc);
        // If validation runs, it might produce diagnostics or not, but it shouldn't be empty purely because of URI mismatch filtering
        // We can force a diagnostic by adding an undeclared account or something, or check if it processed the transaction.
        // But Validator returns a list of diagnostics. If URI mismatch occurs, it skips validation and returns empty list.
        // Let's ensure it DOESN'T skip.
        // We haven't enabled any specific validation that would fail, but let's enable undeclared accounts check which is default.
        // We didn't declare 'Expenses:Food'.

        // Wait, default settings might not trigger anything if everything is fine.
        // Let's expect 'Undeclared account' if it works.

        const settings = {
            validation: {
                undeclaredAccounts: true
            },
            severity: {
                undeclaredAccounts: 'warning'
            }
        };

        const resultWithSettings = validator.validate(mockDocument, mockParsedDoc, { settings: settings as any });

        // Should find undeclared accounts if URI filtering worked correctly
        expect(resultWithSettings.diagnostics.length).toBeGreaterThan(0);
        expect(resultWithSettings.diagnostics[0].message).toContain('Account "Expenses:Food" is used but not declared');
    });

    it('should correctly handle date ordering check with URI mismatch', () => {
        // Add a second transaction with earlier date to trigger date ordering error
        const transaction2: Transaction = {
            date: '2024-12-31', // Earlier than first tx
            description: 'Test 2',
            status: 'uncleared',
            postings: [],
            sourceUri: decodedUri,
            line: 3
        } as unknown as Transaction;

        mockParsedDoc.transactions.push(transaction2);

        const settings = {
            validation: {
                dateOrdering: true
            }
        };

        const result = validator.validate(mockDocument, mockParsedDoc, { settings: settings as any });

        // Should find date ordering issue
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics.some(d => d.message.includes('is before previous transaction date'))).toBe(true);
    });
});
