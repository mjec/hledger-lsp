import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolKind } from 'vscode-languageserver';
import { documentSymbolProvider, workspaceSymbolProvider } from '../../src/features/symbols';
import { parser } from '../../src/parser/index';

describe('DocumentSymbolProvider', () => {
  describe('provideDocumentSymbols', () => {
    test('should return empty array for empty document', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols).toEqual([]);
    });

    test('should return symbols for account directives', () => {
      const content = `account Assets:Bank
account Expenses:Groceries
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe('account Assets:Bank');
      expect(symbols[0].kind).toBe(SymbolKind.Class);
      expect(symbols[1].name).toBe('account Expenses:Groceries');
      expect(symbols[1].kind).toBe(SymbolKind.Class);
    });

    test('should return symbols for commodity directives', () => {
      const content = `commodity USD
commodity EUR
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe('commodity USD');
      expect(symbols[0].kind).toBe(SymbolKind.Number);
      expect(symbols[1].name).toBe('commodity EUR');
      expect(symbols[1].kind).toBe(SymbolKind.Number);
    });

    test('should return symbols for payee directives', () => {
      const content = `payee Grocery Store
payee Coffee Shop
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe('payee Grocery Store');
      expect(symbols[0].kind).toBe(SymbolKind.String);
    });

    test('should return symbols for tag directives', () => {
      const content = `tag project
tag priority
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe('tag project');
      expect(symbols[0].kind).toBe(SymbolKind.Property);
    });

    test('should return symbols for include directives', () => {
      const content = `include accounts.journal
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('include accounts.journal');
      expect(symbols[0].kind).toBe(SymbolKind.File);
    });

    test('should return symbols for transactions', () => {
      const content = `2023-01-15 Grocery Store
  Expenses:Groceries  $50.00
  Assets:Checking

2023-01-16 * Coffee Shop
  Expenses:Coffee  $5.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(2);

      // First transaction
      expect(symbols[0].name).toBe('2023-01-15 Grocery Store');
      expect(symbols[0].kind).toBe(SymbolKind.Event);
      expect(symbols[0].children).toBeDefined();
      expect(symbols[0].children?.length).toBe(2);
      expect(symbols[0].children?.[0].name).toContain('Expenses:Groceries');
      expect(symbols[0].children?.[0].name).toContain('50');
      // Posting without amount now has inferred amount in symbol name
      expect(symbols[0].children?.[1].name).toContain('Assets:Checking');
      expect(symbols[0].children?.[1].name).toContain('-50.00');

      // Second transaction (with cleared status)
      expect(symbols[1].name).toBe('2023-01-16 * Coffee Shop');
      expect(symbols[1].kind).toBe(SymbolKind.Event);
      expect(symbols[1].children).toBeDefined();
      expect(symbols[1].children?.length).toBe(2);
    });

    test('should return symbols for transactions with pending status', () => {
      const content = `2023-01-15 ! Pending Transaction
  Expenses:Test  $10.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('2023-01-15 ! Pending Transaction');
    });

    test('should return symbols for transactions with codes', () => {
      const content = `2023-01-15 (123) Payee with code
  Expenses:Test  $10.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('2023-01-15 Payee with code');
      expect(symbols[0].detail).toBe('123');
    });

    test('should handle mixed directives and transactions', () => {
      const content = `account Assets:Bank
payee Store

2023-01-15 Store
  Expenses:Groceries  $50.00
  Assets:Bank

commodity USD
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(4);

      // Find each symbol by name (order may vary)
      const accountSymbol = symbols.find(s => s.name === 'account Assets:Bank');
      const payeeSymbol = symbols.find(s => s.name === 'payee Store');
      const transactionSymbol = symbols.find(s => s.name === '2023-01-15 Store');
      const commoditySymbol = symbols.find(s => s.name === 'commodity USD');

      expect(accountSymbol).toBeDefined();
      expect(payeeSymbol).toBeDefined();
      expect(transactionSymbol).toBeDefined();
      expect(commoditySymbol).toBeDefined();
    });

    test('should only include symbols from current document when includes are present', () => {
      const content = `include other.journal

account Assets:Bank

2023-01-15 Local Transaction
  Expenses:Test  $10.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);

      // Mock fileReader that returns content for other.journal
      const fileReader = (uri: string) => {
        if (uri.includes('other.journal')) {
          return TextDocument.create(uri, 'hledger', 1,
            'account Expenses:Other\n\n2023-01-10 Other Transaction\n  Expenses:Other  $5.00\n  Assets:Bank\n'
          );
        }
        return null;
      };

      const parsed = parser.parse(doc, {
        baseUri: doc.uri,
        fileReader
      });

      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      // Should only include symbols from the current document
      expect(symbols.length).toBe(3); // include directive, account, transaction
      expect(symbols[0].name).toBe('include other.journal');
      expect(symbols[1].name).toBe('account Assets:Bank');
      expect(symbols[2].name).toBe('2023-01-15 Local Transaction');

      // Should not include symbols from other.journal
      expect(symbols.find(s => s.name.includes('Expenses:Other'))).toBeUndefined();
      expect(symbols.find(s => s.name.includes('Other Transaction'))).toBeUndefined();
    });

    test('should handle directive comments in detail field', () => {
      const content = `account Assets:Bank  ; Main checking account
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('account Assets:Bank');
      expect(symbols[0].detail).toBe('Main checking account');
    });

    test('should handle transactions with posting amounts', () => {
      const content = `2023-01-15 Test
  Assets:Bank  $100.00
  Income:Salary  $-100.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].children?.length).toBe(2);
      expect(symbols[0].children?.[0].name).toContain('Assets:Bank');
      expect(symbols[0].children?.[0].name).toContain('$100');
      expect(symbols[0].children?.[1].name).toContain('Income:Salary');
      expect(symbols[0].children?.[1].name).toContain('$-100');
    });

    test('should handle posting without amount', () => {
      const content = `2023-01-15 Test
  Assets:Bank  $50.00
  Expenses:Test
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = documentSymbolProvider.provideDocumentSymbols(doc, parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].children?.length).toBe(2);
      expect(symbols[0].children?.[0].name).toContain('Assets:Bank');
      expect(symbols[0].children?.[0].name).toContain('50');
      // Posting without amount now has inferred amount in symbol name
      expect(symbols[0].children?.[1].name).toContain('Expenses:Test');
      expect(symbols[0].children?.[1].name).toContain('-50.00'); // Inferred amount
      expect(symbols[0].children?.[1].name).not.toContain('undefined');
    });
  });
});
describe('WorkspaceSymbolProvider', () => {
  describe('provideWorkspaceSymbols', () => {
    test('should return empty array for empty query with empty document', () => {
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, '');
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('', parsed);

      expect(symbols).toEqual([]);
    });

    test('should find accounts by partial name', () => {
      const content = `account Assets:Bank
account Assets:Cash
account Expenses:Food
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('bank', parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('Assets:Bank');
      expect(symbols[0].kind).toBe(SymbolKind.Class);
      expect(symbols[0].containerName).toBe('Declared Account');
    });

    test('should find payees by partial name', () => {
      const content = `payee Grocery Store
payee Coffee Shop
payee Gas Station
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('coffee', parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('Coffee Shop');
      expect(symbols[0].kind).toBe(SymbolKind.String);
      expect(symbols[0].containerName).toBe('Declared Payee');
    });

    test('should find commodities by name', () => {
      const content = `commodity USD
commodity EUR
commodity GBP
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('eur', parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('EUR');
      expect(symbols[0].kind).toBe(SymbolKind.Number);
      expect(symbols[0].containerName).toBe('Declared Commodity');
    });

    test('should find tags by name', () => {
      const content = `tag project
tag priority
tag category
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('proj', parsed);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('project');
      expect(symbols[0].kind).toBe(SymbolKind.Property);
      expect(symbols[0].containerName).toBe('Declared Tag');
    });

    test('should find transactions by description', () => {
      const content = `2023-01-15 Grocery Store
  Expenses:Groceries  $50.00
  Assets:Bank

2023-01-16 Coffee Shop
  Expenses:Coffee  $5.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('grocery', parsed);

      // Will find both the transaction and the Expenses:Groceries account
      expect(symbols.length).toBeGreaterThanOrEqual(1);
      const transactionSymbol = symbols.find(s => s.kind === SymbolKind.Event);
      expect(transactionSymbol).toBeDefined();
      expect(transactionSymbol?.name).toBe('2023-01-15 Grocery Store');
      expect(transactionSymbol?.containerName).toBe('Transaction');
    });

    test('should find multiple symbols matching query', () => {
      const content = `account Assets:Bank
payee Bank of America

2023-01-15 Bank deposit
  Assets:Bank  $100.00
  Income:Salary
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('bank', parsed);

      // Will find Assets:Bank (declared and used), Bank of America payee, and transaction
      expect(symbols.length).toBeGreaterThanOrEqual(3);

      // Find each symbol type
      const accountSymbols = symbols.filter(s => s.kind === SymbolKind.Class);
      const payeeSymbols = symbols.filter(s => s.kind === SymbolKind.String);
      const transactionSymbols = symbols.filter(s => s.kind === SymbolKind.Event);

      expect(accountSymbols.length).toBeGreaterThanOrEqual(1);
      expect(accountSymbols.find(a => a.name === 'Assets:Bank')).toBeDefined();
      expect(payeeSymbols.length).toBeGreaterThanOrEqual(1);
      expect(payeeSymbols.find(p => p.name === 'Bank of America')).toBeDefined();
      expect(transactionSymbols.length).toBeGreaterThanOrEqual(1);
      expect(transactionSymbols.find(t => t.name === '2023-01-15 Bank deposit')).toBeDefined();
    });

    test('should perform case-insensitive search', () => {
      const content = `account Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const symbolsLower = workspaceSymbolProvider.provideWorkspaceSymbols('bank', parsed);
      const symbolsUpper = workspaceSymbolProvider.provideWorkspaceSymbols('BANK', parsed);
      const symbolsMixed = workspaceSymbolProvider.provideWorkspaceSymbols('BaNk', parsed);

      expect(symbolsLower.length).toBe(1);
      expect(symbolsUpper.length).toBe(1);
      expect(symbolsMixed.length).toBe(1);
    });

    test('should include status indicator in transaction symbols', () => {
      const content = `2023-01-15 * Cleared Transaction
  Expenses:Test  $10.00
  Assets:Bank

2023-01-16 ! Pending Transaction
  Expenses:Test  $20.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('transaction', parsed);

      // Find transaction symbols (may also find account symbols)
      const transactionSymbols = symbols.filter(s => s.kind === SymbolKind.Event);
      expect(transactionSymbols.length).toBe(2);
      expect(transactionSymbols[0].name).toContain('*');
      expect(transactionSymbols[1].name).toContain('!');
    });

    test('should return empty array when query does not match', () => {
      const content = `account Assets:Bank
payee Store
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('xyz123notfound', parsed);

      expect(symbols.length).toBe(0);
    });

    test('should distinguish between declared and undeclared items', () => {
      const content = `account Assets:Declared

2023-01-15 Test
  Assets:Declared  $100.00
  Assets:Undeclared
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const symbols = workspaceSymbolProvider.provideWorkspaceSymbols('assets', parsed);

      expect(symbols.length).toBe(2);
      const declaredSymbol = symbols.find(s => s.name === 'Assets:Declared');
      const undeclaredSymbol = symbols.find(s => s.name === 'Assets:Undeclared');

      expect(declaredSymbol?.containerName).toBe('Declared Account');
      expect(undeclaredSymbol?.containerName).toBe('Account');
    });
  });
});
