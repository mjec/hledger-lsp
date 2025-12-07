import { DocumentLinksProvider } from '../../src/features/documentLinks';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('DocumentLinksProvider', () => {
  let provider: DocumentLinksProvider;
  let parser: HledgerParser;

  beforeEach(() => {
    provider = new DocumentLinksProvider();
    parser = new HledgerParser();
  });

  describe('provideDocumentLinks', () => {
    test('should return empty array for document without includes', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toEqual([]);
    });

    test('should provide link for relative include path', () => {
      const content = `include expenses.journal

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///home/user/test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toHaveLength(1);
      expect(links[0].range.start.line).toBe(0);
      expect(links[0].range.start.character).toBe(8); // After "include "
      expect(links[0].range.end.character).toBe(24); // End of "expenses.journal"
      expect(links[0].target).toContain('expenses.journal');
    });

    test('should provide link for absolute include path', () => {
      const content = `include /home/user/accounts/main.journal

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toHaveLength(1);
      expect(links[0].target).toContain('/home/user/accounts/main.journal');
    });

    test('should provide links for multiple includes', () => {
      const content = `include expenses.journal
include income.journal
include assets.journal

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toHaveLength(3);
      expect(links[0].target).toContain('expenses.journal');
      expect(links[1].target).toContain('income.journal');
      expect(links[2].target).toContain('assets.journal');
    });

    test('should handle include with comment', () => {
      const content = `include expenses.journal ; Main expenses file

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toHaveLength(1);
      expect(links[0].range.end.character).toBeLessThan(content.indexOf(';'));
      expect(links[0].target).toContain('expenses.journal');
    });

    test('should handle include with parent directory reference', () => {
      const content = `include ../shared/accounts.journal

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///home/user/journals/test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toHaveLength(1);
      expect(links[0].target).toContain('shared/accounts.journal');
    });

    test('should handle include with extra whitespace', () => {
      const content = `include    expenses.journal

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toHaveLength(1);
      expect(links[0].target).toContain('expenses.journal');
    });

    test('should handle include at different indentation levels', () => {
      const content = `include expenses.journal
  include nested/accounts.journal

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toHaveLength(2);
    });

    test('should not create link for empty include path', () => {
      const content = `include

2024-01-15 * Transaction
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const links = provider.provideDocumentLinks(doc, parsedDoc);

      expect(links).toEqual([]);
    });
  });
});
