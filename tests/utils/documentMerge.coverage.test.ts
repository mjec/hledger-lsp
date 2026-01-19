/**
 * Tests for documentMerge.ts to improve coverage
 * Targets uncovered lines: 68-72 (tag merging with existing entry)
 */
import { createEmptyParsedDocument, mergeParsedDocuments } from '../../src/utils/documentMerge';
import { ParsedDocument, Tag } from '../../src/types';

describe('documentMerge - Coverage Tests', () => {
  describe('createEmptyParsedDocument', () => {
    test('creates empty document with all required fields', () => {
      const doc = createEmptyParsedDocument();

      expect(doc.transactions).toEqual([]);
      expect(doc.accounts).toBeInstanceOf(Map);
      expect(doc.accounts.size).toBe(0);
      expect(doc.directives).toEqual([]);
      expect(doc.commodities).toBeInstanceOf(Map);
      expect(doc.commodities.size).toBe(0);
      expect(doc.payees).toBeInstanceOf(Map);
      expect(doc.payees.size).toBe(0);
      expect(doc.tags).toBeInstanceOf(Map);
      expect(doc.tags.size).toBe(0);
    });
  });

  describe('mergeParsedDocuments', () => {
    test('merges two empty documents', () => {
      const base = createEmptyParsedDocument();
      const included = createEmptyParsedDocument();

      const result = mergeParsedDocuments(base, included);

      expect(result.transactions).toEqual([]);
      expect(result.accounts.size).toBe(0);
      expect(result.directives).toEqual([]);
    });

    test('merges transactions from both documents', () => {
      const base = createEmptyParsedDocument();
      base.transactions = [{ date: '2024-01-01', description: 'Test1', payee: 'Test1', note: '', postings: [], line: 0 }];

      const included = createEmptyParsedDocument();
      included.transactions = [{ date: '2024-01-02', description: 'Test2', payee: 'Test2', note: '', postings: [], line: 0 }];

      const result = mergeParsedDocuments(base, included);

      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].payee).toBe('Test1');
      expect(result.transactions[1].payee).toBe('Test2');
    });

    test('merges directives from both documents', () => {
      const base = createEmptyParsedDocument();
      base.directives = [{ type: 'account', value: 'Assets:Bank', line: 0 }];

      const included = createEmptyParsedDocument();
      included.directives = [{ type: 'account', value: 'Expenses:Food', line: 0 }];

      const result = mergeParsedDocuments(base, included);

      expect(result.directives).toHaveLength(2);
    });

    test('merges accounts preserving declared status', () => {
      const base = createEmptyParsedDocument();
      base.accounts.set('Assets:Bank', { name: 'Assets:Bank', declared: false });
      base.accounts.set('Assets:Cash', { name: 'Assets:Cash', declared: true });

      const included = createEmptyParsedDocument();
      included.accounts.set('Assets:Bank', { name: 'Assets:Bank', declared: true });
      included.accounts.set('Expenses:Food', { name: 'Expenses:Food', declared: true });

      const result = mergeParsedDocuments(base, included);

      expect(result.accounts.size).toBe(3);
      // Assets:Bank should be declared because included has it declared
      expect(result.accounts.get('Assets:Bank')?.declared).toBe(true);
      expect(result.accounts.get('Assets:Cash')?.declared).toBe(true);
      expect(result.accounts.get('Expenses:Food')?.declared).toBe(true);
    });

    test('merges payees preserving declared status', () => {
      const base = createEmptyParsedDocument();
      base.payees.set('Grocery Store', { name: 'Grocery Store', declared: false });

      const included = createEmptyParsedDocument();
      included.payees.set('Grocery Store', { name: 'Grocery Store', declared: true });
      included.payees.set('Gas Station', { name: 'Gas Station', declared: true });

      const result = mergeParsedDocuments(base, included);

      expect(result.payees.size).toBe(2);
      expect(result.payees.get('Grocery Store')?.declared).toBe(true);
      expect(result.payees.get('Gas Station')?.declared).toBe(true);
    });

    test('merges commodities preserving declared status', () => {
      const base = createEmptyParsedDocument();
      base.commodities.set('$', { name: '$', declared: false });

      const included = createEmptyParsedDocument();
      included.commodities.set('$', { name: '$', declared: true });
      included.commodities.set('EUR', { name: 'EUR', declared: true });

      const result = mergeParsedDocuments(base, included);

      expect(result.commodities.size).toBe(2);
      expect(result.commodities.get('$')?.declared).toBe(true);
      expect(result.commodities.get('EUR')?.declared).toBe(true);
    });

    test('merges tags preserving declared status - existing tag becomes declared', () => {
      // Test lines 68-72: tag merging with existing entry
      const base = createEmptyParsedDocument();
      base.tags.set('project', { name: 'project', declared: false });
      base.tags.set('client', { name: 'client', declared: true });

      const included = createEmptyParsedDocument();
      included.tags.set('project', { name: 'project', declared: true });
      included.tags.set('category', { name: 'category', declared: false });

      const result = mergeParsedDocuments(base, included);

      expect(result.tags.size).toBe(3);
      // project should be declared because included has it declared
      expect(result.tags.get('project')?.declared).toBe(true);
      // client stays declared
      expect(result.tags.get('client')?.declared).toBe(true);
      // category is new from included
      expect(result.tags.get('category')?.declared).toBe(false);
    });

    test('merges tags - existing declared tag stays declared', () => {
      const base = createEmptyParsedDocument();
      base.tags.set('project', { name: 'project', declared: true });

      const included = createEmptyParsedDocument();
      included.tags.set('project', { name: 'project', declared: false });

      const result = mergeParsedDocuments(base, included);

      // project should stay declared (base had it declared)
      expect(result.tags.get('project')?.declared).toBe(true);
    });

    test('adds new tags from included document', () => {
      const base = createEmptyParsedDocument();
      base.tags.set('existing', { name: 'existing', declared: true });

      const included = createEmptyParsedDocument();
      included.tags.set('newTag', { name: 'newTag', declared: false });

      const result = mergeParsedDocuments(base, included);

      expect(result.tags.size).toBe(2);
      expect(result.tags.has('existing')).toBe(true);
      expect(result.tags.has('newTag')).toBe(true);
    });

    test('handles empty base with populated included', () => {
      const base = createEmptyParsedDocument();

      const included = createEmptyParsedDocument();
      included.accounts.set('Assets:Bank', { name: 'Assets:Bank', declared: true });
      included.payees.set('Test', { name: 'Test', declared: true });
      included.commodities.set('$', { name: '$', declared: true });
      included.tags.set('project', { name: 'project', declared: true });
      included.transactions = [{ date: '2024-01-01', description: 'Test', payee: 'Test', note: '', postings: [], line: 0 }];

      const result = mergeParsedDocuments(base, included);

      expect(result.accounts.size).toBe(1);
      expect(result.payees.size).toBe(1);
      expect(result.commodities.size).toBe(1);
      expect(result.tags.size).toBe(1);
      expect(result.transactions).toHaveLength(1);
    });

    test('handles populated base with empty included', () => {
      const base = createEmptyParsedDocument();
      base.accounts.set('Assets:Bank', { name: 'Assets:Bank', declared: true });
      base.tags.set('project', { name: 'project', declared: true });

      const included = createEmptyParsedDocument();

      const result = mergeParsedDocuments(base, included);

      expect(result.accounts.size).toBe(1);
      expect(result.tags.size).toBe(1);
    });
  });
});
