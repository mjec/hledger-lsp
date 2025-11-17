import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity, Range, CodeActionKind } from 'vscode-languageserver';
import { codeActionProvider } from '../../src/features/codeActions';
import { parser } from '../../src/parser/index';

describe('CodeActionProvider', () => {
  describe('provideCodeActions', () => {
    test('should return empty array when no diagnostics', () => {
      const content = `account Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const range = Range.create(0, 0, 0, 0);
      const actions = codeActionProvider.provideCodeActions(doc, range, [], parsed);

      expect(actions).toEqual([]);
    });

    test('should provide quick fix for undeclared account', () => {
      const content = `2023-01-15 Test
  Assets:Checking  $100.00
  Expenses:Food
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(2, 2, 2, 15),
        message: 'Account "Expenses:Food" is used but not declared with \'account\' directive',
        severity: DiagnosticSeverity.Warning,
        source: 'hledger',
        code: 'undeclared-account',
        data: { accountName: 'Expenses:Food' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      // Should have quick fix action
      expect(actions.length).toBeGreaterThanOrEqual(1);

      const quickFix = actions.find(a => a.kind === CodeActionKind.QuickFix);
      expect(quickFix).toBeDefined();
      expect(quickFix!.title).toBe("Add declaration for account 'Expenses:Food'");
      expect(quickFix!.kind).toBe(CodeActionKind.QuickFix);
      expect(quickFix!.diagnostics).toEqual([diagnostic]);
      expect(quickFix!.edit).toBeDefined();
      expect(quickFix!.edit?.changes).toBeDefined();

      const changes = quickFix!.edit!.changes![doc.uri];
      expect(changes.length).toBe(1);
      expect(changes[0].newText).toBe('account Expenses:Food\n');
    });

    test('should provide quick fix for undeclared payee', () => {
      const content = `2023-01-15 Grocery Store
  Expenses:Food  $50.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(0, 11, 0, 24),
        message: 'Payee "Grocery Store" is used but not declared with \'payee\' directive',
        severity: DiagnosticSeverity.Warning,
        source: 'hledger',
        code: 'undeclared-payee',
        data: { payeeName: 'Grocery Store' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      const quickFix = actions.find(a => a.kind === CodeActionKind.QuickFix);
      expect(quickFix).toBeDefined();
      expect(quickFix!.title).toBe("Add declaration for payee 'Grocery Store'");
      expect(quickFix!.kind).toBe(CodeActionKind.QuickFix);

      const changes = quickFix!.edit!.changes![doc.uri];
      expect(changes[0].newText).toBe('payee Grocery Store\n');
    });

    test('should provide quick fix for undeclared commodity', () => {
      const content = `2023-01-15 Test
  Assets:Bank  100 USD
  Expenses:Test
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(1, 19, 1, 22),
        message: 'Commodity "USD" is used but not declared with \'commodity\' directive',
        severity: DiagnosticSeverity.Warning,
        source: 'hledger',
        code: 'undeclared-commodity',
        data: { commodityName: 'USD' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      expect(actions.length).toBe(1);
      expect(actions[0].title).toBe("Add declaration for commodity 'USD'");
      expect(actions[0].kind).toBe(CodeActionKind.QuickFix);

      const changes = actions[0].edit!.changes![doc.uri];
      expect(changes[0].newText).toBe('commodity USD\n');
    });

    test('should provide quick fix for undeclared tag', () => {
      const content = `2023-01-15 Test  ; project:work
  Expenses:Test  $10.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(0, 19, 0, 26),
        message: 'Tag "project" is used but not declared with \'tag\' directive',
        severity: DiagnosticSeverity.Information,
        source: 'hledger',
        code: 'undeclared-tag',
        data: { tagName: 'project' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      const quickFix = actions.find(a => a.kind === CodeActionKind.QuickFix);
      expect(quickFix).toBeDefined();
      expect(quickFix!.title).toBe("Add declaration for tag 'project'");
      expect(quickFix!.kind).toBe(CodeActionKind.QuickFix);

      const changes = quickFix!.edit!.changes![doc.uri];
      expect(changes[0].newText).toBe('tag project\n');
    });

    test('should insert account directive after existing account directives', () => {
      const content = `account Assets:Bank
account Assets:Cash

2023-01-15 Test
  Expenses:Food  $10.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(4, 2, 4, 15),
        message: 'Account "Expenses:Food" is used but not declared with \'account\' directive',
        severity: DiagnosticSeverity.Warning,
        source: 'hledger',
        code: 'undeclared-account',
        data: { accountName: 'Expenses:Food' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      const quickFix = actions.find(a => a.kind === CodeActionKind.QuickFix);
      expect(quickFix).toBeDefined();
      const changes = quickFix!.edit!.changes![doc.uri];

      // Should insert after the last account directive (line 1, after "account Assets:Cash")
      expect(changes[0].range.start.line).toBe(2);
      expect(changes[0].newText).toBe('account Expenses:Food\n');
    });

    test('should insert payee directive after existing payee directives', () => {
      const content = `payee Store A
payee Store B

2023-01-15 Store C
  Expenses:Test  $10.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(3, 11, 3, 18),
        message: 'Payee "Store C" is used but not declared with \'payee\' directive',
        severity: DiagnosticSeverity.Warning,
        source: 'hledger',
        code: 'undeclared-payee',
        data: { payeeName: 'Store C' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      const quickFix = actions.find(a => a.kind === CodeActionKind.QuickFix);
      expect(quickFix).toBeDefined();
      const changes = quickFix!.edit!.changes![doc.uri];

      // Should insert after the last payee directive
      expect(changes[0].range.start.line).toBe(2);
      expect(changes[0].newText).toBe('payee Store C\n');
    });

    test('should insert directive at top of file when no directives exist', () => {
      const content = `2023-01-15 Test
  Expenses:Food  $10.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(1, 2, 1, 15),
        message: 'Account "Expenses:Food" is used but not declared with \'account\' directive',
        severity: DiagnosticSeverity.Warning,
        source: 'hledger',
        code: 'undeclared-account',
        data: { accountName: 'Expenses:Food' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      const quickFix = actions.find(a => a.kind === CodeActionKind.QuickFix);
      expect(quickFix).toBeDefined();
      const changes = quickFix!.edit!.changes![doc.uri];

      // Should insert at the top of the file
      expect(changes[0].range.start.line).toBe(0);
      expect(changes[0].range.start.character).toBe(0);
      expect(changes[0].newText).toBe('account Expenses:Food\n');
    });

    test('should handle multiple diagnostics and provide multiple actions', () => {
      const content = `2023-01-15 Grocery Store
  Expenses:Food  $50.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostics: Diagnostic[] = [
        {
          range: Range.create(0, 11, 0, 24),
          message: 'Payee "Grocery Store" is used but not declared with \'payee\' directive',
          severity: DiagnosticSeverity.Warning,
          source: 'hledger',
          code: 'undeclared-payee',
          data: { payeeName: 'Grocery Store' }
        },
        {
          range: Range.create(1, 2, 1, 15),
          message: 'Account "Expenses:Food" is used but not declared with \'account\' directive',
          severity: DiagnosticSeverity.Warning,
          source: 'hledger',
          code: 'undeclared-account',
          data: { accountName: 'Expenses:Food' }
        },
        {
          range: Range.create(2, 2, 2, 13),
          message: 'Account "Assets:Cash" is used but not declared with \'account\' directive',
          severity: DiagnosticSeverity.Warning,
          source: 'hledger',
          code: 'undeclared-account',
          data: { accountName: 'Assets:Cash' }
        }
      ];

      const actions = codeActionProvider.provideCodeActions(
        doc,
        Range.create(0, 0, 2, 100),
        diagnostics,
        parsed
      );

      expect(actions.length).toBe(3);
      expect(actions[0].title).toContain('Grocery Store');
      expect(actions[1].title).toContain('Expenses:Food');
      expect(actions[2].title).toContain('Assets:Cash');
    });

    test('should not provide actions for non-fixable diagnostics', () => {
      const content = `2023-01-15 Test
  Expenses:Food  $100.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(0, 0, 2, 100),
        message: 'Transaction does not balance',
        severity: DiagnosticSeverity.Error,
        source: 'hledger'
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      expect(actions.length).toBe(0);
    });

    test('should insert after other directive types when same type does not exist', () => {
      const content = `account Assets:Bank
commodity USD

2023-01-15 Store A
  Expenses:Test  $10.00
  Assets:Bank
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const diagnostic: Diagnostic = {
        range: Range.create(3, 11, 3, 18),
        message: 'Payee "Store A" is used but not declared with \'payee\' directive',
        severity: DiagnosticSeverity.Warning,
        source: 'hledger',
        code: 'undeclared-payee',
        data: { payeeName: 'Store A' }
      };

      const actions = codeActionProvider.provideCodeActions(
        doc,
        diagnostic.range,
        [diagnostic],
        parsed
      );

      const quickFix = actions.find(a => a.kind === CodeActionKind.QuickFix);
      expect(quickFix).toBeDefined();
      const changes = quickFix!.edit!.changes![doc.uri];

      // Should insert after the last directive (commodity USD is on line 1)
      expect(changes[0].range.start.line).toBe(2);
      expect(changes[0].newText).toBe('payee Store A\n');
    });
  });

  describe('Rename refactoring', () => {
    test('should find all account references', () => {
      const content = `account Assets:Bank

2023-01-15 Test
  Assets:Bank  $100.00
  Expenses:Food

2023-01-16 Test2
  Assets:Bank  $50.00
  Expenses:Other
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const references = codeActionProvider.findAccountReferences(doc, 'Assets:Bank', parsed);

      // Should find 3 references: 1 directive + 2 postings
      expect(references.length).toBe(3);
      expect(references[0].start.line).toBe(0); // directive
      expect(references[1].start.line).toBe(3); // first posting
      expect(references[2].start.line).toBe(7); // second posting
    });

    test('should find all payee references', () => {
      const content = `payee Grocery Store

2023-01-15 Grocery Store
  Expenses:Food  $50.00
  Assets:Cash

2023-01-16 Grocery Store
  Expenses:Food  $30.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const references = codeActionProvider.findPayeeReferences(doc, 'Grocery Store', parsed);

      // Should find 3 references: 1 directive + 2 transaction headers
      expect(references.length).toBe(3);
      expect(references[0].start.line).toBe(0); // directive
      expect(references[1].start.line).toBe(2); // first transaction
      expect(references[2].start.line).toBe(6); // second transaction
    });

    test('should find all commodity references', () => {
      const content = `commodity USD

2023-01-15 Test
  Expenses:Food  100 USD
  Assets:Cash  -100 USD
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const references = codeActionProvider.findCommodityReferences(doc, 'USD', parsed);

      // Should find 3 references: 1 directive + 2 amounts
      expect(references.length).toBeGreaterThanOrEqual(3);
    });

    test('should find all tag references', () => {
      const content = `tag project

2023-01-15 Test  ; project:work
  Expenses:Food  $50.00  ; project:work
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const references = codeActionProvider.findTagReferences(doc, 'project', parsed);

      // Should find 3 references: 1 directive + 2 tags in comments
      expect(references.length).toBe(3);
      expect(references[0].start.line).toBe(0); // directive
      expect(references[1].start.line).toBe(2); // transaction comment
      expect(references[2].start.line).toBe(3); // posting comment
    });

    test('should create rename edit for account', () => {
      const content = `account Assets:Bank

2023-01-15 Test
  Assets:Bank  $100.00
  Expenses:Food
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const item = { type: 'account' as const, name: 'Assets:Bank' };
      const edit = codeActionProvider.createRenameEdit(doc, item, 'Assets:Checking', parsed);

      expect(edit.changes).toBeDefined();
      expect(edit.changes![doc.uri]).toBeDefined();
      expect(edit.changes![doc.uri].length).toBe(2); // 1 directive + 1 posting

      // Check that all edits replace with the new name
      for (const textEdit of edit.changes![doc.uri]) {
        expect(textEdit.newText).toBe('Assets:Checking');
      }
    });

    test('should create rename edit for payee', () => {
      const content = `payee Store A

2023-01-15 Store A
  Expenses:Food  $50.00
  Assets:Cash
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const item = { type: 'payee' as const, name: 'Store A' };
      const edit = codeActionProvider.createRenameEdit(doc, item, 'Store B', parsed);

      expect(edit.changes).toBeDefined();
      expect(edit.changes![doc.uri]).toBeDefined();
      expect(edit.changes![doc.uri].length).toBe(2); // 1 directive + 1 transaction

      for (const textEdit of edit.changes![doc.uri]) {
        expect(textEdit.newText).toBe('Store B');
      }
    });

    test('should not provide rename action via code actions (use LSP rename provider instead)', () => {
      const content = `account Assets:Bank

2023-01-15 Test
  Assets:Bank  $100.00
  Expenses:Food
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      // Cursor on "Assets:Bank" in the posting (line 3, column 2)
      const range = Range.create(3, 2, 3, 2);
      const actions = codeActionProvider.provideCodeActions(doc, range, [], parsed);

      // Rename actions should not be provided via code actions
      // Use the LSP rename provider (vim.lsp.buf.rename() or F2) instead
      const renameAction = actions.find(a => a.title.includes('Rename'));
      expect(renameAction).toBeUndefined();
    });
  });
});
