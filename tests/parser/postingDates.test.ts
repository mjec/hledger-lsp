import { HledgerParser } from '../../src/parser';
import * as ast from '../../src/parser/ast';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('Posting Date Parsing', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  describe('date: tag syntax', () => {
    test('should parse full date (YYYY-MM-DD)', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:2024-01-20
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].postings).toHaveLength(2);
      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
      expect(result.transactions[0].postings[1].date).toBeUndefined();
    });

    test('should parse full date with slashes (YYYY/MM/DD)', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:2024/01/20
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });

    test('should parse partial date (MM-DD) and default to transaction year', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:01-20
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });

    test('should parse partial date with slashes (MM/DD)', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:01/20
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });

    test('should remove date from tags map', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:2024-01-20, trip:paris
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      const posting = result.transactions[0].postings[0];
      expect(posting.date).toBe('2024-01-20');
      expect(posting.tags?.date).toBeUndefined(); // Should be removed from tags
      expect(posting.tags?.trip).toBe('paris'); // Other tags should remain
    });

    test('should handle invalid date format by not setting date', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:invalid
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBeUndefined();
      expect(result.transactions[0].postings[0].tags?.date).toBe('invalid'); // Stays in tags if invalid
    });
  });

  describe('bracketed [DATE] syntax', () => {
    test('should parse full bracketed date [YYYY-MM-DD]', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; [2024-01-20]
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });

    test('should parse full bracketed date with slashes [YYYY/MM/DD]', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; [2024/01/20]
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });

    test('should parse partial bracketed date [MM-DD]', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; [01-20]
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });

    test('should parse partial bracketed date with slashes [MM/DD]', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; [01/20]
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });

    test('should handle bracketed date with surrounding text', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; bank cleared on [2024-01-20]
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
    });
  });

  describe('precedence: date: tag vs [DATE] syntax', () => {
    test('should prefer date: tag over bracketed syntax', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:2024-01-25 [2024-01-20]
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      // date: tag should take precedence
      expect(result.transactions[0].postings[0].date).toBe('2024-01-25');
    });

    test('should prefer date: tag even if it appears after bracketed syntax', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; [2024-01-20] date:2024-01-25
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-25');
    });
  });

  describe('multiple postings with dates', () => {
    test('should parse multiple postings with different dates', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:2024-01-16
    expenses:gas   $20  ; date:2024-01-18
    assets:cash         ; date:2024-01-20`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-16');
      expect(result.transactions[0].postings[1].date).toBe('2024-01-18');
      expect(result.transactions[0].postings[2].date).toBe('2024-01-20');
    });

    test('should mix postings with and without dates', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:2024-01-20
    expenses:gas   $20  ; no date
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-20');
      expect(result.transactions[0].postings[1].date).toBeUndefined();
      expect(result.transactions[0].postings[2].date).toBeUndefined();
    });
  });

  describe('hledger documentation example', () => {
    test('should parse the bank clearing date example', () => {
      const content = `2015/5/30
    expenses:food     $10  ; food purchased on saturday 5/30
    assets:checking        ; bank cleared it on monday, date:6/1`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].date).toBe('2015/5/30'); // Original format preserved
      expect(result.transactions[0].postings[0].date).toBeUndefined(); // No date specified
      expect(result.transactions[0].postings[1].date).toBe('2015-06-01'); // Parsed from date:6/1, normalized
    });
  });

  describe('edge cases', () => {
    test('should handle posting date before transaction date', () => {
      const content = `2024-01-20 Test
    expenses:food  $10  ; date:2024-01-15
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-15');
    });

    test('should handle posting date after transaction date', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:2024-01-25
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBe('2024-01-25');
    });

    test('should handle empty date: tag', () => {
      const content = `2024-01-15 Test
    expenses:food  $10  ; date:
    assets:cash`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const result = parser.parse(doc);

      expect(result.transactions[0].postings[0].date).toBeUndefined();
      expect(result.transactions[0].postings[0].tags?.date).toBe(''); // Empty value stays in tags
    });
  });

  describe('ast.parsePosting direct tests', () => {
    test('should parse posting with date: tag', () => {
      const result = ast.parsePosting('    expenses:food  $10  ; date:2024-01-20', '2024-01-15');
      expect(result?.date).toBe('2024-01-20');
    });

    test('should parse posting with bracketed date', () => {
      const result = ast.parsePosting('    expenses:food  $10  ; [2024-01-20]', '2024-01-15');
      expect(result?.date).toBe('2024-01-20');
    });

    test('should default partial date to transaction year', () => {
      const result = ast.parsePosting('    expenses:food  $10  ; date:06-15', '2025-03-10');
      expect(result?.date).toBe('2025-06-15');
    });

    test('should not parse date without transaction date context', () => {
      const result = ast.parsePosting('    expenses:food  $10  ; date:06-15');
      expect(result?.date).toBeUndefined();
      expect(result?.tags?.date).toBe('06-15'); // Stays in tags
    });

    test('should prefer date: tag over bracketed syntax', () => {
      const result = ast.parsePosting('    expenses:food  $10  ; date:2024-01-25 [2024-01-20]', '2024-01-15');
      expect(result?.date).toBe('2024-01-25');
    });
  });
});
