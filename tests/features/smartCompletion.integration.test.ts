/**
 * Integration tests for smart completion using real journal files
 */

import { URI } from 'vscode-uri';
import { CompletionProvider } from '../../src/features/completion';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parser } from '../../src/parser';
import { CompletionItemKind } from 'vscode-languageserver';
import { defaultFileReader } from '../../src/utils/uri';
import * as path from 'path';
import * as fs from 'fs';

describe('Smart Completion Integration Tests', () => {
  let provider: CompletionProvider;
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  const mainJournalPath = path.join(fixturesPath, 'main.journal');

  beforeEach(() => {
    provider = new CompletionProvider();
  });

  describe('with real journal file', () => {
    test('should load and parse main journal with includes', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);
      const doc = TextDocument.create(uri.toString(), 'hledger', 1, content);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      // Should have transactions from both main and included file
      expect(parsed.transactions.length).toBeGreaterThan(25);

      // Should have all declared accounts
      expect(parsed.accounts.size).toBeGreaterThan(5);

      // Should have declared payees
      expect(parsed.payees.size).toBeGreaterThan(4);
    });

    test('should suggest Whole Foods accounts based on history', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      // Add a new transaction with Whole Foods at the end
      const modifiedContent = content + '\n\n2024-03-01 * Whole Foods\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      // Update provider with parsed data
      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);
      provider.updateCommodities(parsed.commodities);

      // Get completion at the posting line
      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Should return account completions
      expect(items.length).toBeGreaterThan(0);
      expect(items.every(item => item.kind === CompletionItemKind.Field)).toBe(true);

      // Expenses:Food:Groceries should be suggested (used 7x with Whole Foods)
      const groceriesItem = items.find(i => i.label === 'Expenses:Food:Groceries');
      expect(groceriesItem).toBeDefined();
      expect(groceriesItem!.detail).toContain('Whole Foods');
      expect(groceriesItem!.detail).toMatch(/\d+x/); // Should show frequency

      // Assets:Checking should also be suggested
      const checkingItem = items.find(i => i.label === 'Assets:Checking');
      expect(checkingItem).toBeDefined();
      expect(checkingItem!.detail).toContain('Whole Foods');

      // These two should be sorted first (payee-specific suggestions)
      const groceriesIndex = items.findIndex(i => i.label === 'Expenses:Food:Groceries');
      const checkingIndex = items.findIndex(i => i.label === 'Assets:Checking');

      // Both should be in top positions
      expect(groceriesIndex).toBeLessThan(5);
      expect(checkingIndex).toBeLessThan(5);
    });

    test('should suggest Shell Gas Station accounts based on history', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      // Add a new transaction with Shell Gas Station
      const modifiedContent = content + '\n\n2024-03-05 * Shell Gas Station\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);

      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Expenses:Transport:Gas should be suggested (used 8x with Shell)
      const gasItem = items.find(i => i.label === 'Expenses:Transport:Gas');
      expect(gasItem).toBeDefined();
      expect(gasItem!.detail).toContain('Shell Gas Station');

      // Assets:Checking should also be suggested
      const checkingItem = items.find(i => i.label === 'Assets:Checking');
      expect(checkingItem).toBeDefined();
      expect(checkingItem!.detail).toContain('Shell Gas Station');
    });

    test('should suggest Uber accounts based on history', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      const modifiedContent = content + '\n\n2024-03-10 * Uber\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);

      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Expenses:Transport:Transit should be suggested (used 5x with Uber)
      const transitItem = items.find(i => i.label === 'Expenses:Transport:Transit');
      expect(transitItem).toBeDefined();
      expect(transitItem!.detail).toContain('Uber');

      // Should NOT suggest Expenses:Transport:Gas (never used with Uber)
      const gasItem = items.find(i => i.label === 'Expenses:Transport:Gas');
      if (gasItem) {
        expect(gasItem.detail).not.toContain('Uber');
      }
    });

    test('should show correct frequency counts', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      const modifiedContent = content + '\n\n2024-03-01 * Whole Foods\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);

      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Whole Foods appears 7 times in both files
      const groceriesItem = items.find(i => i.label === 'Expenses:Food:Groceries');
      expect(groceriesItem).toBeDefined();
      expect(groceriesItem!.detail).toContain('7x');
    });

    test('should handle new payee without history', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      // Add transaction with a new payee
      const modifiedContent = content + '\n\n2024-03-15 * Target\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);

      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Should still get completions, sorted by global frequency
      expect(items.length).toBeGreaterThan(0);

      // Assets:Checking should be high up (most frequently used globally)
      const checkingItem = items.find(i => i.label === 'Assets:Checking');
      expect(checkingItem).toBeDefined();

      // Should not have payee-specific frequency info
      expect(checkingItem!.detail).not.toContain('Target');
      expect(checkingItem!.detail).toBe('Account');
    });

    test('should work with incomplete transactions', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      // Add incomplete transaction
      const modifiedContent = content + '\n\n2024-03-20 * Safeway\n    Expenses:Food:Groceries       $45.00\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);

      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Should still suggest based on payee
      const checkingItem = items.find(i => i.label === 'Assets:Checking');
      expect(checkingItem).toBeDefined();
      expect(checkingItem!.detail).toContain('Safeway');
    });

    test('should handle payee with different account combinations', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      // ACME Corp uses different accounts (Income:Salary instead of Expenses)
      const modifiedContent = content + '\n\n2024-03-31 * ACME Corp\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);

      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Should suggest Assets:Checking and Income:Salary (used 2x each)
      const checkingItem = items.find(i => i.label === 'Assets:Checking');
      const salaryItem = items.find(i => i.label === 'Income:Salary');

      expect(checkingItem).toBeDefined();
      expect(checkingItem!.detail).toContain('ACME Corp');

      expect(salaryItem).toBeDefined();
      expect(salaryItem!.detail).toContain('ACME Corp');
    });
  });

  describe('global frequency ordering', () => {
    test('should sort accounts by global frequency when no payee match', () => {
      const content = fs.readFileSync(mainJournalPath, 'utf8');
      const uri = URI.file(mainJournalPath);

      // Add transaction with unknown payee
      const modifiedContent = content + '\n\n2024-03-25 * Random Store\n    ';

      const doc = TextDocument.create(uri.toString(), 'hledger', 1, modifiedContent);
      const parsed = parser.parse(doc, {
        baseUri: uri,
        fileReader: defaultFileReader
      });

      provider.updateAccounts(parsed.accounts);
      provider.updatePayees(parsed.payees);

      const lines = modifiedContent.split('\n');
      const lastLine = lines.length - 1;
      const position = { line: lastLine, character: 4 };

      const items = provider.getCompletionItems(doc, position, parsed);

      // Assets:Checking should be first (used most frequently across all transactions)
      const checkingIndex = items.findIndex(i => i.label === 'Assets:Checking');

      // Less frequently used accounts should be later
      const waterIndex = items.findIndex(i => i.label === 'Expenses:Utilities:Water');

      expect(checkingIndex).toBeLessThan(waterIndex);
    });
  });
});
