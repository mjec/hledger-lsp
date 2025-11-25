import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range } from 'vscode-languageserver';
import { CodeActionProvider } from '../../src/features/codeActions';
import { ParsedDocument } from '../../src/types';

describe('Split Posting Code Actions', () => {
  let codeActionProvider: CodeActionProvider;
  let parsedDoc: ParsedDocument;

  beforeEach(() => {
    codeActionProvider = new CodeActionProvider();
    parsedDoc = {
      transactions: [],
      accounts: new Map(),
      directives: [],
      commodities: new Map(),
      payees: new Map(),
      tags: new Map()
    };
  });

  describe('getPostingAtPosition', () => {
    it('should detect a posting with amount', () => {
      const content = `2025-01-15 Grocery shopping
    expenses:groceries                 $100.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10); // On the groceries line

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      // Should have 3 split actions (2, 3, and 4 parts)
      expect(actions.length).toBe(3);
      expect(actions[0].title).toBe('Split posting into 2 equal parts');
      expect(actions[1].title).toBe('Split posting into 3 equal parts');
      expect(actions[2].title).toBe('Split posting into 4 equal parts');
    });

    it('should not detect split actions on non-posting lines', () => {
      const content = `2025-01-15 Grocery shopping
    expenses:groceries                 $100.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(0, 10); // On the transaction header

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      // Should have no split actions
      expect(actions.length).toBe(0);
    });

    it('should not detect split actions on postings without amounts', () => {
      const content = `2025-01-15 Grocery shopping
    expenses:groceries                 $100.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(2, 10); // On checking account (no amount)

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      // Should have no split actions
      expect(actions.length).toBe(0);
    });
  });

  describe('split into 2 parts', () => {
    it('should split $100 into 2 equal parts', () => {
      const content = `2025-01-15 Grocery shopping
    expenses:groceries                 $100.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10);

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      const splitAction = actions.find(a => a.title === 'Split posting into 2 equal parts');
      expect(splitAction).toBeDefined();
      expect(splitAction!.edit).toBeDefined();

      const edits = splitAction!.edit!.changes![document.uri];
      expect(edits.length).toBe(1);

      const newText = edits[0].newText;
      expect(newText).toContain('expenses:groceries');
      expect(newText).toContain('expenses:groceries:2');
      expect(newText).toContain('$50.00');
    });

    it('should split $100 into 3 equal parts with proper remainder handling', () => {
      const content = `2025-01-15 Grocery shopping
    expenses:groceries                 $100.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10);

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      const splitAction = actions.find(a => a.title === 'Split posting into 3 equal parts');
      expect(splitAction).toBeDefined();

      const edits = splitAction!.edit!.changes![document.uri];
      const newText = edits[0].newText;

      expect(newText).toContain('expenses:groceries');
      expect(newText).toContain('expenses:groceries:2');
      expect(newText).toContain('expenses:groceries:3');

      // Check that amounts sum to $100.00
      const amounts = newText.match(/\$(\d+\.\d+)/g) || [];
      const sum = amounts.reduce((acc, amt) => {
        return acc + parseFloat(amt.substring(1));
      }, 0);
      expect(sum).toBeCloseTo(100.00, 2);
    });

    it('should handle negative amounts', () => {
      const content = `2025-01-15 Grocery shopping
    expenses:groceries                 -$50.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10);

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      const splitAction = actions.find(a => a.title === 'Split posting into 2 equal parts');
      expect(splitAction).toBeDefined();

      const edits = splitAction!.edit!.changes![document.uri];
      const newText = edits[0].newText;

      expect(newText).toContain('-$25.00');
    });

    it('should correctly split -$100 into 3 parts', () => {
      const content = `2025-01-15 Test
    expenses:test                      -$100.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10);

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      const splitAction = actions.find(a => a.title === 'Split posting into 3 equal parts');
      expect(splitAction).toBeDefined();

      const edits = splitAction!.edit!.changes![document.uri];
      const newText = edits[0].newText;

      // Should be -33.33, -33.33, -33.34 (not -33.34, -33.34, -33.32)
      const amounts = newText.match(/-\$\d+\.\d+/g) || [];
      expect(amounts).toHaveLength(3);
      expect(amounts[0]).toBe('-$33.33');
      expect(amounts[1]).toBe('-$33.33');
      expect(amounts[2]).toBe('-$33.34');

      // Verify they sum to -100.00
      const sum = amounts.reduce((acc, amt) => {
        // Parse "-$33.33" correctly: remove $ and parse the rest
        const value = parseFloat(amt.replace('$', ''));
        return acc + value;
      }, 0);
      expect(sum).toBeCloseTo(-100.00, 2);
    });

    it('should handle different commodity symbols (£)', () => {
      const content = `2025-01-15 Shopping
    expenses:shopping                  £60.00
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10);

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      const splitAction = actions.find(a => a.title === 'Split posting into 2 equal parts');
      expect(splitAction).toBeDefined();

      const edits = splitAction!.edit!.changes![document.uri];
      const newText = edits[0].newText;

      expect(newText).toContain('£30.00');
    });

    it('should handle commodity codes (USD)', () => {
      const content = `2025-01-15 Shopping
    expenses:shopping                  75.00 USD
    assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10);

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      const splitAction = actions.find(a => a.title === 'Split posting into 3 equal parts');
      expect(splitAction).toBeDefined();

      const edits = splitAction!.edit!.changes![document.uri];
      const newText = edits[0].newText;

      expect(newText).toContain('25.00 USD');
    });

    it('should preserve indentation', () => {
      const content = `2025-01-15 Grocery shopping
        expenses:groceries                 $100.00
        assets:checking`;

      const document = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = Position.create(1, 10);

      const actions = codeActionProvider.provideCodeActions(
        document,
        Range.create(position, position),
        [],
        parsedDoc
      );

      const splitAction = actions.find(a => a.title === 'Split posting into 2 equal parts');
      expect(splitAction).toBeDefined();

      const edits = splitAction!.edit!.changes![document.uri];
      const newText = edits[0].newText;

      // Check that new postings start with same indentation (8 spaces)
      const lines = newText.split('\n');
      expect(lines[0]).toMatch(/^        /); // 8 spaces
      expect(lines[1]).toMatch(/^        /); // 8 spaces
    });
  });
});
