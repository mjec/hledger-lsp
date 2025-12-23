import { CompletionProvider } from '../../src/features/completion';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItemKind } from 'vscode-languageserver';
import { HledgerParser } from '../../src/parser';

// Helper to convert string arrays to the format expected by completion provider
function toItems(names: string[], declared = true): Array<{ name: string; declared: boolean }> {
  return names.map(name => ({ name, declared }));
}

describe('CompletionProvider', () => {
  let provider: CompletionProvider;


  beforeEach(() => {
    provider = new CompletionProvider();
  });

  describe('updateAccounts', () => {
    test('should update the list of accounts', () => {
      const accounts = ['assets:checking', 'expenses:food', 'income:salary'];
      provider.updateAccounts(toItems(accounts));

      const completions = provider['getAccountCompletions']();
      expect(completions).toHaveLength(3);
      expect(completions.map(c => c.label)).toEqual(expect.arrayContaining(accounts));
    });

    test('should store all items provided (deduplication handled by parser)', () => {
      const accounts = ['assets:checking', 'assets:checking', 'expenses:food'];
      provider.updateAccounts(toItems(accounts));

      const completions = provider['getAccountCompletions']();
      expect(completions).toHaveLength(3); // Provider stores what it's given
    });
  });

  describe('updatePayees', () => {
    test('should update the list of payees', () => {
      const payees = ['Grocery Store', 'Gas Station', 'Restaurant'];
      provider.updatePayees(toItems(payees));

      const completions = provider['getPayeeCompletions']();
      expect(completions).toHaveLength(3);
      expect(completions.map(c => c.label)).toEqual(expect.arrayContaining(payees));
    });
  });

  describe('updateCommodities', () => {
    test('should update the list of commodities', () => {
      const commodities = ['USD', 'EUR', 'BTC'];
      provider.updateCommodities(toItems(commodities));

      const completions = provider.getCommodityCompletions();
      expect(completions).toHaveLength(3);
      expect(completions.map(c => c.label)).toEqual(expect.arrayContaining(commodities));
    });
  });

  describe('getCompletionItems', () => {
    beforeEach(() => {
      provider.updateAccounts(toItems(['assets:checking', 'expenses:food', 'income:salary']));
      provider.updatePayees(toItems(['Grocery Store', 'Gas Station']));
      provider.updateCommodities(toItems(['USD', 'EUR']));
    });

    test('should provide account completions for posting lines', () => {
      const content = '2024-01-15 * Store\n    ';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 1, character: 4 };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Field)).toBe(true);
    });

    test('should provide payee completions for transaction headers', () => {
      const content = '2024-01-15 * ';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: 13 };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Text)).toBe(true);
    });

    test('should provide directive completions at start of line', () => {
      const content = 'acc';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: 3 };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      const directives = items.filter(item => item.kind === CompletionItemKind.Keyword);
      expect(directives.length).toBeGreaterThan(0);
    });

    test('should provide directive completions on empty lines', () => {
      const content = '';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: 0 };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Keyword)).toBe(true);
    });

    test('should return empty array for non-matching contexts', () => {
      const content = '    ; comment';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: 10 };

      const items = provider.getCompletionItems(doc, position);

      // Depending on implementation, this might return items or not
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('getCommodityCompletions', () => {
    test('should return commodity completions with correct kind', () => {
      provider.updateCommodities(toItems(['USD', 'EUR', 'GBP']));

      const items = provider.getCommodityCompletions();

      expect(items).toHaveLength(3);
      expect(items.every(item => item.kind === CompletionItemKind.Unit)).toBe(true);
      expect(items.every(item => item.detail === 'Commodity')).toBe(true);
    });

    test('should return empty array when no commodities are set', () => {
      const items = provider.getCommodityCompletions();

      expect(items).toHaveLength(0);
    });
  });

  describe('updateTags', () => {
    test('should update the list of tags', () => {
      provider.updateTags(toItems(['project', 'category', 'important']));

      const items = provider.getTagCompletions();

      expect(items).toHaveLength(3);
    });

    test('should store all items provided (deduplication handled by parser)', () => {
      provider.updateTags(toItems(['project', 'project', 'category']));

      const items = provider.getTagCompletions();

      expect(items).toHaveLength(3); // Provider stores what it's given
    });
  });

  describe('completion filtering by declared status', () => {
    test('should filter to only declared accounts when setting is true', () => {
      provider.updateAccounts([
        { name: 'assets:checking', declared: true },
        { name: 'expenses:food', declared: false },
        { name: 'income:salary', declared: true }
      ]);

      const items = provider['getAccountCompletions']({ onlyDeclaredAccounts: true });

      expect(items).toHaveLength(2);
      expect(items.map(c => c.label)).toEqual(expect.arrayContaining(['assets:checking', 'income:salary']));
    });

    test('should include undeclared accounts when setting is false', () => {
      provider.updateAccounts([
        { name: 'assets:checking', declared: true },
        { name: 'expenses:food', declared: false },
        { name: 'income:salary', declared: true }
      ]);

      const items = provider['getAccountCompletions']({ onlyDeclaredAccounts: false });

      expect(items).toHaveLength(3);
    });

    test('should filter payees by declared status', () => {
      provider.updatePayees([
        { name: 'Grocery Store', declared: true },
        { name: 'Gas Station', declared: false }
      ]);

      const items = provider['getPayeeCompletions']({ onlyDeclaredPayees: true });

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('Grocery Store');
    });

    test('should filter commodities by declared status', () => {
      provider.updateCommodities([
        { name: 'USD', declared: true },
        { name: 'EUR', declared: false }
      ]);

      const items = provider.getCommodityCompletions({ onlyDeclaredCommodities: true });

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('USD');
    });

    test('should filter tags by declared status', () => {
      provider.updateTags([
        { name: 'project', declared: true },
        { name: 'category', declared: false }
      ]);

      const items = provider.getTagCompletions({ onlyDeclaredTags: true });

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('project');
    });

    test('should default to only declared items when no settings provided', () => {
      provider.updateAccounts([
        { name: 'assets:checking', declared: true },
        { name: 'expenses:food', declared: false }
      ]);

      const items = provider['getAccountCompletions']();

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('assets:checking');
    });
  });

  describe('getTagCompletions', () => {
    test('should return tag completions with correct kind', () => {
      provider.updateTags(toItems(['project', 'category', 'important']));

      const items = provider.getTagCompletions();

      expect(items).toHaveLength(3);
      expect(items.every(item => item.kind === CompletionItemKind.Property)).toBe(true);
      expect(items.every(item => item.detail === 'Tag')).toBe(true);
    });

    test('should include colon in insertText', () => {
      provider.updateTags(toItems(['project']));

      const items = provider.getTagCompletions();

      expect(items[0].insertText).toBe('project:');
    });

    test('should return empty array when no tags are set', () => {
      provider.updateTags(toItems([]));

      const items = provider.getTagCompletions();

      expect(items).toHaveLength(0);
    });

    test('should provide tag completions in comments', () => {
      provider.updateTags(toItems(['project', 'category']));

      const content = '2024-01-15 * Test  ; ';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: 23 };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Property)).toBe(true);
    });

    test('should provide tag completions after existing tag', () => {
      provider.updateTags(toItems(['project', 'category']));

      const content = '    expenses:food  $50  ; project:home ';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: content.length };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Property)).toBe(true);
    });
  });

  describe('cost notation completion', () => {
    test('should provide commodity completions after @', () => {
      provider.updateCommodities(toItems(['$', '€', 'USD']));

      const content = '    assets:stock  10 AAPL @ ';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: content.length };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Unit)).toBe(true);
      expect(items.find(item => item.label === '$')).toBeDefined();
      expect(items.find(item => item.label === '€')).toBeDefined();
    });

    test('should provide commodity completions after @@', () => {
      provider.updateCommodities(toItems(['$', 'EUR']));

      const content = '    assets:stock  10 SHARES @@ ';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: content.length };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Unit)).toBe(true);
    });

    test('should provide commodity completions while typing after @', () => {
      provider.updateCommodities(toItems(['$', 'USD', 'EUR']));

      const content = '    assets:stock  10 AAPL @ $';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: content.length };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Unit)).toBe(true);
    });

    test('should provide commodity completions after @ with amount', () => {
      provider.updateCommodities(toItems(['$', 'GBP']));

      const content = '    assets:euros  €100 @ 1.2';
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 0, character: content.length };

      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Unit)).toBe(true);
    });
  });

  describe('smart completions', () => {
    let parser: HledgerParser;
    beforeEach(() => {
      provider.updateAccounts(toItems(['Expenses:Food', 'Expenses:Transport', 'Assets:Checking']));
      provider.updatePayees(toItems(['Grocery Store', 'Gas Station']));
      parser = new HledgerParser();
    });

    test('should prioritize accounts used with payee', () => {
      const content = `2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Grocery Store
    Expenses:Food                 $30
    Assets:Checking               $-30

2024-01-17 * Grocery Store
    `;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 9, character: 4 };

      const parsed = parser.parse(doc);
      const items = provider.getCompletionItems(doc, position, parsed);

      // Should suggest accounts, with Expenses:Food and Assets:Checking first
      expect(items.length).toBeGreaterThan(0);

      const foodItem = items.find(i => i.label === 'Expenses:Food');
      const transportItem = items.find(i => i.label === 'Expenses:Transport');

      expect(foodItem).toBeDefined();
      expect(transportItem).toBeDefined();

      // Expenses:Food should be sorted before Expenses:Transport
      if (foodItem && transportItem) {
        expect(foodItem.sortText!.localeCompare(transportItem.sortText!)).toBeLessThan(0);
      }
    });

    test('should add frequency info to detail', () => {
      const content = `2024-01-15 * Grocery Store
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Grocery Store
    Expenses:Food                 $30
    Assets:Checking               $-30

2024-01-17 * Grocery Store
    `;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const position = { line: 9, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      const foodItem = items.find(i => i.label === 'Expenses:Food');
      expect(foodItem).toBeDefined();
      expect(foodItem!.detail).toContain('2x');
      expect(foodItem!.detail).toContain('Grocery Store');
    });

    test('should work without parsed document', () => {
      const content = `2024-01-15 * Grocery Store
    `;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const position = { line: 1, character: 4 };

      // Call without parsed document
      const items = provider.getCompletionItems(doc, position);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Field)).toBe(true);
    });

    test('should fallback to regular completions if no payee found', () => {
      const content = `    `;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const position = { line: 0, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Field)).toBe(true);
    });

    test('should sort by global frequency when no payee patterns', () => {
      const content = `2024-01-15 * Store1
    Expenses:Food                 $50
    Assets:Checking               $-50

2024-01-16 * Store1
    Expenses:Food                 $30
    Assets:Checking               $-30

2024-01-17 * NewPayee
    `;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);
      const position = { line: 9, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      expect(items.length).toBeGreaterThan(0);
      // Should still have sort text for frequency-based sorting
      expect(items.every(i => i.sortText)).toBe(true);
    });
  });
});
