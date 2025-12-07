
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HoverProvider } from '../../src/features/hover';
import { ParsedDocument, Transaction } from '../../src/types';

describe('HoverProvider Workspace Context', () => {
    let hoverProvider: HoverProvider;
    let mockDocument: TextDocument;

    beforeEach(() => {
        hoverProvider = new HoverProvider();
        mockDocument = TextDocument.create('file:///home/user/main.journal', 'hledger', 1, '    Expenses:Food    10.00 USD');
    });

    it('should report account as UNDECLARED if not in parsed document (local context only)', () => {
        // Simulating document-only parse where "Expenses:Food" is defined in another file causing it to be missing or undeclared in local map
        // If it's not in the map, it defaults to undeclared in the hover logic?
        // hover.ts: const account = parsed.accounts.get(accountName);
        // If !account, it returns basic hover (just name).
        // Wait, if it's used but not declared, the parser usually adds it to the accounts map with declared: false.

        const accountName = 'Expenses:Food';
        const parsedDocLocal: ParsedDocument = {
            transactions: [], // No transactions in this view
            accounts: new Map([
                [accountName, { name: accountName, declared: false }] // Inferred from usage, not declared locally
            ]),
            commodities: new Map(),
            payees: new Map(),
            tags: new Map(),
            directives: []
        } as any;

        const hover = hoverProvider.provideHover(mockDocument, 0, 10, parsedDocLocal);
        // Expect "Undeclared"
        const contents = (hover?.contents as any).value;
        expect(contents).toContain('**Status:** Undeclared');
    });

    it('should report account as DECLARED if in parsed document (workspace context)', () => {
        // Simulating workspace parse where "Expenses:Food" is declared in 'accounts.journal'
        const accountName = 'Expenses:Food';
        const parsedDocWorkspace: ParsedDocument = {
            transactions: [],
            accounts: new Map([
                [accountName, { name: accountName, declared: true, sourceUri: 'file:///home/user/accounts.journal' }]
            ]),
            commodities: new Map(),
            payees: new Map(),
            tags: new Map(),
            directives: []
        } as any;

        const hover = hoverProvider.provideHover(mockDocument, 0, 10, parsedDocWorkspace);
        // Expect "Declared"
        const contents = (hover?.contents as any).value;
        expect(contents).toContain('**Status:** Declared');
        expect(contents).toContain('accounts.journal');
    });

    it('should show global usage count if transactions from other files are included', () => {
        const accountName = 'Expenses:Food';
        // Workspace parse includes transactions from other files
        const parsedDocWorkspace: ParsedDocument = {
            transactions: [
                {
                    postings: [{ account: accountName }, { account: 'Assets:Cash' }]
                },
                {
                    postings: [{ account: accountName }, { account: 'Liabilities:Credit' }]
                }
            ] as any,
            accounts: new Map([
                [accountName, { name: accountName, declared: true }]
            ]),
            commodities: new Map(),
            payees: new Map(),
            tags: new Map(),
            directives: []
        } as any;

        const hover = hoverProvider.provideHover(mockDocument, 0, 10, parsedDocWorkspace);
        const contents = (hover?.contents as any).value;
        expect(contents).toContain('**Usage:** 2 postings');
    });
});
