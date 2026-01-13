/**
 * Tests for workspace-wide rename and find references functionality
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../src/parser/index';
import { codeActionProvider } from '../../src/features/codeActions';
import { findReferencesProvider } from '../../src/features/findReferences';
import { FileReader } from '../../src/types';

describe('Workspace-wide rename and references', () => {
  const parser = new HledgerParser();

  describe('createWorkspaceRenameEdit', () => {
    test('should rename account across multiple files', () => {
      // Create test documents
      const mainContent = `include accounts.journal
include transactions.journal

2023-01-15 Opening Balance
  Assets:Bank  $1000.00
  Equity:Opening
`;

      const accountsContent = `account Assets:Bank
account Expenses:Food
account Equity:Opening
`;

      const transactionsContent = `2023-01-16 Grocery Store
  Expenses:Food  $50.00
  Assets:Bank

2023-01-17 Restaurant
  Expenses:Food  $30.00
  Assets:Bank
`;

      const mainDoc = TextDocument.create('file:///test/main.journal', 'hledger', 1, mainContent);
      const accountsDoc = TextDocument.create('file:///test/accounts.journal', 'hledger', 1, accountsContent);
      const transactionsDoc = TextDocument.create('file:///test/transactions.journal', 'hledger', 1, transactionsContent);

      // Create a fileReader that returns our test documents
      const fileReader: FileReader = (uri: URI) => {
        const uriString = uri.toString();
        if (uriString === 'file:///test/main.journal') return mainDoc;
        if (uriString === 'file:///test/accounts.journal') return accountsDoc;
        if (uriString === 'file:///test/transactions.journal') return transactionsDoc;
        return null;
      };

      const fileUris = [
        URI.parse('file:///test/main.journal'),
        URI.parse('file:///test/accounts.journal'),
        URI.parse('file:///test/transactions.journal')
      ];

      const item = { type: 'account' as const, name: 'Assets:Bank' };
      const edit = codeActionProvider.createWorkspaceRenameEdit(
        item,
        'Assets:Checking',
        fileUris,
        parser,
        fileReader
      );

      // Verify edits were created
      expect(edit.changes).toBeDefined();
      expect(Object.keys(edit.changes!).length).toBeGreaterThan(0);

      // Check main.journal has 1 reference (in transaction)
      const mainEdits = edit.changes!['file:///test/main.journal'];
      expect(mainEdits).toBeDefined();
      expect(mainEdits.length).toBe(1);

      // Check accounts.journal has 1 reference (account directive)
      const accountsEdits = edit.changes!['file:///test/accounts.journal'];
      expect(accountsEdits).toBeDefined();
      expect(accountsEdits.length).toBe(1);

      // Check transactions.journal has 2 references (2 postings)
      const transactionsEdits = edit.changes!['file:///test/transactions.journal'];
      expect(transactionsEdits).toBeDefined();
      expect(transactionsEdits.length).toBe(2);

      // Verify all edits replace with the new name
      [...mainEdits, ...accountsEdits, ...transactionsEdits].forEach(edit => {
        expect(edit.newText).toBe('Assets:Checking');
      });
    });

    test('should rename payee across multiple files', () => {
      const mainContent = `include payees.journal

2023-01-15 Store A
  Expenses:Food  $50.00
  Assets:Cash
`;

      const payeesContent = `payee Store A
payee Store B
`;

      const mainDoc = TextDocument.create('file:///test/main.journal', 'hledger', 1, mainContent);
      const payeesDoc = TextDocument.create('file:///test/payees.journal', 'hledger', 1, payeesContent);

      const fileReader: FileReader = (uri: URI) => {
        const uriString = uri.toString();
        if (uriString === 'file:///test/main.journal') return mainDoc;
        if (uriString === 'file:///test/payees.journal') return payeesDoc;
        return null;
      };

      const fileUris = [
        URI.parse('file:///test/main.journal'),
        URI.parse('file:///test/payees.journal')
      ];

      const item = { type: 'payee' as const, name: 'Store A' };
      const edit = codeActionProvider.createWorkspaceRenameEdit(
        item,
        'Market A',
        fileUris,
        parser,
        fileReader
      );

      expect(edit.changes).toBeDefined();

      // Check main.journal has 1 reference (transaction)
      const mainEdits = edit.changes!['file:///test/main.journal'];
      expect(mainEdits).toBeDefined();
      expect(mainEdits.length).toBe(1);
      expect(mainEdits[0].newText).toBe('Market A');

      // Check payees.journal has 1 reference (payee directive)
      const payeesEdits = edit.changes!['file:///test/payees.journal'];
      expect(payeesEdits).toBeDefined();
      expect(payeesEdits.length).toBe(1);
      expect(payeesEdits[0].newText).toBe('Market A');
    });

    test('should rename commodity across multiple files', () => {
      const mainContent = `commodity USD

2023-01-15 Test
  Assets:Bank  100.00 USD
  Equity:Opening
`;

      const otherContent = `2023-01-16 Test
  Assets:Bank  50.00 USD
  Expenses:Food
`;

      const mainDoc = TextDocument.create('file:///test/main.journal', 'hledger', 1, mainContent);
      const otherDoc = TextDocument.create('file:///test/other.journal', 'hledger', 1, otherContent);

      const fileReader: FileReader = (uri: URI) => {
        const uriString = uri.toString();
        if (uriString === 'file:///test/main.journal') return mainDoc;
        if (uriString === 'file:///test/other.journal') return otherDoc;
        return null;
      };

      const fileUris = [
        URI.parse('file:///test/main.journal'),
        URI.parse('file:///test/other.journal')
      ];

      const item = { type: 'commodity' as const, name: 'USD' };
      const edit = codeActionProvider.createWorkspaceRenameEdit(
        item,
        'USDC',
        fileUris,
        parser,
        fileReader
      );

      expect(edit.changes).toBeDefined();

      // Should have edits in both files
      expect(edit.changes!['file:///test/main.journal']).toBeDefined();
      expect(edit.changes!['file:///test/other.journal']).toBeDefined();

      // All edits should replace with new name
      const allEdits = [
        ...edit.changes!['file:///test/main.journal'],
        ...edit.changes!['file:///test/other.journal']
      ];
      allEdits.forEach(edit => {
        expect(edit.newText).toBe('USDC');
      });
    });

    test('should handle files with no references', () => {
      const file1Content = `2023-01-15 Test
  Assets:Bank  $100.00
  Expenses:Food
`;

      const file2Content = `2023-01-16 Another
  Assets:Savings  $50.00
  Income:Salary
`;

      const doc1 = TextDocument.create('file:///test/file1.journal', 'hledger', 1, file1Content);
      const doc2 = TextDocument.create('file:///test/file2.journal', 'hledger', 1, file2Content);

      const fileReader: FileReader = (uri: URI) => {
        const uriString = uri.toString();
        if (uriString === 'file:///test/file1.journal') return doc1;
        if (uriString === 'file:///test/file2.journal') return doc2;
        return null;
      };

      const fileUris = [
        URI.parse('file:///test/file1.journal'),
        URI.parse('file:///test/file2.journal')
      ];

      const item = { type: 'account' as const, name: 'Assets:Bank' };
      const edit = codeActionProvider.createWorkspaceRenameEdit(
        item,
        'Assets:Checking',
        fileUris,
        parser,
        fileReader
      );

      expect(edit.changes).toBeDefined();

      // Only file1 should have edits
      expect(edit.changes!['file:///test/file1.journal']).toBeDefined();
      expect(edit.changes!['file:///test/file1.journal'].length).toBe(1);

      // file2 should not have edits
      expect(edit.changes!['file:///test/file2.journal']).toBeUndefined();
    });
  });

  describe('findWorkspaceReferences', () => {
    test('should find account references across multiple files', () => {
      const mainContent = `include transactions.journal

account Assets:Bank

2023-01-15 Opening
  Assets:Bank  $1000.00
  Equity:Opening
`;

      const transactionsContent = `2023-01-16 Purchase
  Expenses:Food  $50.00
  Assets:Bank
`;

      const mainDoc = TextDocument.create('file:///test/main.journal', 'hledger', 1, mainContent);
      const transactionsDoc = TextDocument.create('file:///test/transactions.journal', 'hledger', 1, transactionsContent);

      const fileReader: FileReader = (uri: URI) => {
        const uriString = uri.toString();
        if (uriString === 'file:///test/main.journal') return mainDoc;
        if (uriString === 'file:///test/transactions.journal') return transactionsDoc;
        return null;
      };

      // Parse main document first
      const parsed = parser.parse(mainDoc, { fileReader });

      const fileUris = [
        URI.parse('file:///test/main.journal'),
        URI.parse('file:///test/transactions.journal')
      ];

      // Position on "Assets:Bank" in the account directive (line 2, col 10)
      const position = { line: 2, character: 10 };

      const locations = findReferencesProvider.findWorkspaceReferences(
        mainDoc,
        position,
        parsed,
        fileUris,
        parser,
        fileReader
      );

      expect(locations).not.toBeNull();
      expect(locations!.length).toBe(3); // 1 directive + 1 posting in main + 1 posting in transactions

      // Verify we have locations from both files
      const mainLocations = locations!.filter(loc => loc.uri === 'file:///test/main.journal');
      const transactionsLocations = locations!.filter(loc => loc.uri === 'file:///test/transactions.journal');

      expect(mainLocations.length).toBe(2); // directive + posting
      expect(transactionsLocations.length).toBe(1); // posting
    });

    test('should find payee references across multiple files', () => {
      const mainContent = `payee Store A

2023-01-15 Store A
  Expenses:Food  $50.00
  Assets:Cash
`;

      const otherContent = `2023-01-16 Store A
  Expenses:Food  $30.00
  Assets:Cash
`;

      const mainDoc = TextDocument.create('file:///test/main.journal', 'hledger', 1, mainContent);
      const otherDoc = TextDocument.create('file:///test/other.journal', 'hledger', 1, otherContent);

      const fileReader: FileReader = (uri: URI) => {
        const uriString = uri.toString();
        if (uriString === 'file:///test/main.journal') return mainDoc;
        if (uriString === 'file:///test/other.journal') return otherDoc;
        return null;
      };

      const parsed = parser.parse(mainDoc, { fileReader });

      const fileUris = [
        URI.parse('file:///test/main.journal'),
        URI.parse('file:///test/other.journal')
      ];

      // Position on "Store A" in the payee directive
      const position = { line: 0, character: 8 };

      const locations = findReferencesProvider.findWorkspaceReferences(
        mainDoc,
        position,
        parsed,
        fileUris,
        parser,
        fileReader
      );

      expect(locations).not.toBeNull();
      expect(locations!.length).toBe(3); // 1 directive + 2 transactions

      const mainLocations = locations!.filter(loc => loc.uri === 'file:///test/main.journal');
      const otherLocations = locations!.filter(loc => loc.uri === 'file:///test/other.journal');

      expect(mainLocations.length).toBe(2); // directive + transaction
      expect(otherLocations.length).toBe(1); // transaction
    });

    test('should return null when cursor is not on a valid item', () => {
      const content = `2023-01-15 Test
  Assets:Bank  $100.00
  Expenses:Food
`;

      const doc = TextDocument.create('file:///test/test.journal', 'hledger', 1, content);
      const parsed = parser.parse(doc);

      const fileUris = [URI.parse('file:///test/test.journal')];

      // Position on whitespace
      const position = { line: 0, character: 0 };

      const locations = findReferencesProvider.findWorkspaceReferences(
        doc,
        position,
        parsed,
        fileUris,
        parser
      );

      expect(locations).toBeNull();
    });
  });

  describe('Error handling', () => {
    test('should handle missing fileReader gracefully', () => {
      // This test verifies that the methods work without a fileReader
      // (falls back to reading from disk, which will fail in tests but shouldn't crash)

      const fileUris = [URI.parse('file:///nonexistent/test.journal')];
      const item = { type: 'account' as const, name: 'Assets:Bank' };

      // Should not throw, even though file doesn't exist
      expect(() => {
        const edit = codeActionProvider.createWorkspaceRenameEdit(
          item,
          'Assets:Checking',
          fileUris,
          parser
          // No fileReader provided
        );
        // Edit should be empty since file doesn't exist
        expect(Object.keys(edit.changes!).length).toBe(0);
      }).not.toThrow();
    });

    test('should skip files that fail to parse', () => {
      const validContent = `2023-01-15 Test
  Assets:Bank  $100.00
  Expenses:Food
`;

      const validDoc = TextDocument.create('file:///test/valid.journal', 'hledger', 1, validContent);

      // Create a fileReader that returns null for one file (simulating parse failure)
      const fileReader: FileReader = (uri: URI) => {
        if (uri.toString() === 'file:///test/valid.journal') return validDoc;
        return null; // Simulate missing file
      };

      const fileUris = [
        URI.parse('file:///test/valid.journal'),
        URI.parse('file:///test/invalid.journal') // This will fail to load
      ];

      const item = { type: 'account' as const, name: 'Assets:Bank' };

      // Should not throw, even though one file fails
      const edit = codeActionProvider.createWorkspaceRenameEdit(
        item,
        'Assets:Checking',
        fileUris,
        parser,
        fileReader
      );

      expect(edit.changes).toBeDefined();
      // Should only have edits for the valid file
      expect(edit.changes!['file:///test/valid.journal']).toBeDefined();
      expect(edit.changes!['file:///test/invalid.journal']).toBeUndefined();
    });
  });
});
