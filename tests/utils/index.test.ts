import {
  isTransactionHeader,
  isPosting,
  isComment,
  isDirective,
  extractAccountFromPosting,
  extractTags,
  getIndentationLevel,
} from '../../src/utils';

describe('Utility Functions', () => {
  describe('isTransactionHeader', () => {
    test('should identify valid transaction headers with dash separator', () => {
      expect(isTransactionHeader('2024-01-15 * Grocery Store')).toBe(true);
      expect(isTransactionHeader('2024-12-31 ! Pending Transaction')).toBe(true);
      expect(isTransactionHeader('2024-01-01 Opening Balance')).toBe(true);
    });

    test('should identify valid transaction headers with slash separator', () => {
      expect(isTransactionHeader('2024/01/15 * Grocery Store')).toBe(true);
      expect(isTransactionHeader('2024/12/31 ! Pending Transaction')).toBe(true);
    });

    test('should reject invalid transaction headers', () => {
      expect(isTransactionHeader('    assets:checking')).toBe(false);
      expect(isTransactionHeader('account assets:bank')).toBe(false);
      expect(isTransactionHeader('; comment')).toBe(false);
      expect(isTransactionHeader('')).toBe(false);
    });

    test('should handle whitespace correctly', () => {
      expect(isTransactionHeader('  2024-01-15 * Store')).toBe(true);
      expect(isTransactionHeader('\t2024-01-15 * Store')).toBe(true);
    });
  });

  describe('isPosting', () => {
    test('should identify valid posting lines', () => {
      expect(isPosting('    assets:checking    $100.00')).toBe(true);
      expect(isPosting('  expenses:food')).toBe(true);
      expect(isPosting('\tassets:bank')).toBe(true);
    });

    test('should reject non-posting lines', () => {
      expect(isPosting('2024-01-15 * Transaction')).toBe(false);
      expect(isPosting('account assets:bank')).toBe(false);
      expect(isPosting('')).toBe(false);
      expect(isPosting('no indentation')).toBe(false);
    });
  });

  describe('isComment', () => {
    test('should identify comment lines', () => {
      expect(isComment('; This is a comment')).toBe(true);
      expect(isComment('# This is also a comment')).toBe(true);
      expect(isComment('  ; indented comment')).toBe(true);
      expect(isComment('  # indented comment')).toBe(true);
    });

    test('should reject non-comment lines', () => {
      expect(isComment('2024-01-15 * Transaction')).toBe(false);
      expect(isComment('    assets:checking')).toBe(false);
      expect(isComment('')).toBe(false);
    });
  });

  describe('isDirective', () => {
    test('should identify directive lines', () => {
      expect(isDirective('account assets:bank')).toBe(true);
      expect(isDirective('commodity $')).toBe(true);
      expect(isDirective('payee Grocery Store')).toBe(true);
      expect(isDirective('tag project')).toBe(true);
      expect(isDirective('include other.journal')).toBe(true);
      expect(isDirective('alias checking = assets:bank:checking')).toBe(true);
      expect(isDirective('end')).toBe(true);
    });

    test('should reject non-directive lines', () => {
      expect(isDirective('2024-01-15 * Transaction')).toBe(false);
      expect(isDirective('    assets:checking')).toBe(false);
      expect(isDirective('; comment')).toBe(false);
      expect(isDirective('')).toBe(false);
    });
  });

  describe('extractAccountFromPosting', () => {
    test('should extract account names from postings', () => {
      expect(extractAccountFromPosting('    assets:checking')).toBe('assets:checking');
      expect(extractAccountFromPosting('  expenses:food:groceries  $50.00')).toBe('expenses:food:groceries');
      expect(extractAccountFromPosting('    income:salary    $3000.00')).toBe('income:salary');
    });

    test('should handle accounts with spaces in names', () => {
      expect(extractAccountFromPosting('    assets:bank account  $100.00')).toBe('assets:bank account');
    });

    test('should handle postings with comments', () => {
      expect(extractAccountFromPosting('    assets:checking  $100.00  ; comment')).toBe('assets:checking');
      expect(extractAccountFromPosting('    expenses:food  ; tag:value')).toBe('expenses:food');
    });

    test('should handle postings with assertions', () => {
      expect(extractAccountFromPosting('    assets:checking  $100.00 = $1000.00')).toBe('assets:checking');
    });

    test('should return null for invalid postings', () => {
      expect(extractAccountFromPosting('')).toBe(null);
      expect(extractAccountFromPosting('    ')).toBe(null);
    });
  });

  describe('extractTags', () => {
    test('should extract tags from comments', () => {
      expect(extractTags('trip:vacation')).toEqual({ trip: 'vacation' });
      expect(extractTags('project:work, category:dining')).toEqual({
        project: 'work',
        category: 'dining'
      });
    });

    test('should handle tags without values', () => {
      expect(extractTags('important:')).toEqual({ important: '' });
      expect(extractTags('tag1:, tag2:value')).toEqual({
        tag1: '',
        tag2: 'value'
      });
    });

    test('should handle multiple tags', () => {
      expect(extractTags('trip:vacation category:dining status:pending')).toEqual({
        trip: 'vacation',
        category: 'dining',
        status: 'pending'
      });
    });

    test('should return empty object for no tags', () => {
      expect(extractTags('just a comment')).toEqual({});
      expect(extractTags('')).toEqual({});
    });
  });

  describe('getIndentationLevel', () => {
    test('should calculate indentation with spaces', () => {
      expect(getIndentationLevel('    text')).toBe(4);
      expect(getIndentationLevel('  text')).toBe(2);
      expect(getIndentationLevel('        text')).toBe(8);
    });

    test('should calculate indentation with tabs', () => {
      expect(getIndentationLevel('\ttext')).toBe(1);
      expect(getIndentationLevel('\t\ttext')).toBe(2);
    });

    test('should return 0 for no indentation', () => {
      expect(getIndentationLevel('text')).toBe(0);
      expect(getIndentationLevel('')).toBe(0);
    });

    test('should handle mixed tabs and spaces', () => {
      expect(getIndentationLevel('\t  text')).toBe(3);
      expect(getIndentationLevel('  \ttext')).toBe(3);
    });
  });

});
