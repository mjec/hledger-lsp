import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as ast from '../../src/parser/ast';

describe('Auto Posting Parsing', () => {
  const parser = new HledgerParser();

  function parse(content: string) {
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    return parser.parse(doc);
  }

  describe('parseMultiplierAmount (ast)', () => {
    test('should parse simple factor', () => {
      const result = ast.parseMultiplierAmount('0.25');
      expect(result).not.toBeNull();
      expect(result!.factor).toBeCloseTo(0.25);
      expect(result!.commodity).toBeUndefined();
    });

    test('should parse factor with commodity prefix', () => {
      const result = ast.parseMultiplierAmount('$2');
      expect(result).not.toBeNull();
      expect(result!.factor).toBe(2);
      expect(result!.commodity).toBe('$');
    });

    test('should parse negative factor', () => {
      const result = ast.parseMultiplierAmount('-1');
      expect(result).not.toBeNull();
      expect(result!.factor).toBe(-1);
    });

    test('should parse negative factor with commodity', () => {
      const result = ast.parseMultiplierAmount('-$3.50');
      expect(result).not.toBeNull();
      expect(result!.factor).toBeCloseTo(-3.5);
      expect(result!.commodity).toBe('$');
    });

    test('should parse factor of 1', () => {
      const result = ast.parseMultiplierAmount('1');
      expect(result).not.toBeNull();
      expect(result!.factor).toBe(1);
    });
  });

  describe('parseAutoPosting (ast)', () => {
    test('should parse basic auto posting with fixed amounts', () => {
      const lines = ['= expenses:food', '    budget:food    $-50', '    assets:checking    $50'];
      const result = ast.parseAutoPosting(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.query).toBe('expenses:food');
      expect(result!.postings).toHaveLength(2);
      expect(result!.postings[0].account).toBe('budget:food');
      expect(result!.postings[0].amount?.quantity).toBe(-50);
    });

    test('should parse auto posting with multiplier amounts', () => {
      const lines = ['= expenses:food', '    budget:food  *-1', '    assets:checking  *1'];
      const result = ast.parseAutoPosting(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.postings).toHaveLength(2);
      expect(result!.postings[0].multiplier).toBeDefined();
      expect(result!.postings[0].multiplier?.factor).toBe(-1);
      expect(result!.postings[1].multiplier?.factor).toBe(1);
    });

    test('should parse auto posting with comment', () => {
      const lines = ['= expenses:food  ; auto-generated', '    budget:food  *-1'];
      const result = ast.parseAutoPosting(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.comment).toBe('auto-generated');
    });

    test('should parse query with regex-like patterns', () => {
      const queries = ['expenses:food', '^assets', 'expenses:.*:food'];
      for (const query of queries) {
        const lines = [`= ${query}`, '    budget:test  *-1'];
        const result = ast.parseAutoPosting(lines, 0);
        expect(result).not.toBeNull();
        expect(result!.query).toBe(query);
      }
    });

    test('should parse empty auto posting (no postings)', () => {
      const lines = ['= expenses:food'];
      const result = ast.parseAutoPosting(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.postings).toHaveLength(0);
    });

    test('should set correct line numbers', () => {
      const lines = ['= expenses:food', '    budget:food  *-1', '    assets:checking  *1'];
      const result = ast.parseAutoPosting(lines, 10);
      expect(result).not.toBeNull();
      expect(result!.line).toBe(10);
      expect(result!.postings[0].line).toBe(11);
      expect(result!.postings[1].line).toBe(12);
    });

    test('should return null for non-auto-posting line', () => {
      const result = ast.parseAutoPosting(['not an auto posting'], 0);
      expect(result).toBeNull();
    });

    test('should parse multiplier with commodity', () => {
      const lines = ['= expenses:food', '    budget:food  *$2'];
      const result = ast.parseAutoPosting(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.postings[0].multiplier).toBeDefined();
      expect(result!.postings[0].multiplier?.factor).toBe(2);
      expect(result!.postings[0].multiplier?.commodity).toBe('$');
    });

    test('should parse with tags', () => {
      const lines = ['= expenses:food  ; type:auto', '    budget:food  *-1'];
      const result = ast.parseAutoPosting(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.tags).toEqual({ type: 'auto' });
    });
  });

  describe('integration via HledgerParser', () => {
    test('should parse single auto posting', () => {
      const result = parse('= expenses:food\n    budget:food  *-1\n    assets:checking  *1\n');
      expect(result.autoPostings).toHaveLength(1);
      expect(result.autoPostings[0].query).toBe('expenses:food');
      expect(result.autoPostings[0].postings).toHaveLength(2);
    });

    test('should parse multiple auto postings', () => {
      const content = [
        '= expenses:food',
        '    budget:food  *-1',
        '',
        '= expenses:rent',
        '    budget:rent  *-1',
      ].join('\n');
      const result = parse(content);
      expect(result.autoPostings).toHaveLength(2);
      expect(result.autoPostings[0].query).toBe('expenses:food');
      expect(result.autoPostings[1].query).toBe('expenses:rent');
    });

    test('should parse mixed with regular and periodic transactions', () => {
      const content = [
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
        '',
        '= expenses:food',
        '    budget:food  *-1',
        '',
        '2024-01-01 Grocery Store',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n');
      const result = parse(content);
      expect(result.periodicTransactions).toHaveLength(1);
      expect(result.autoPostings).toHaveLength(1);
      expect(result.transactions).toHaveLength(1);
    });

    test('should extract accounts into accounts map', () => {
      const result = parse('= expenses:food\n    budget:food  *-1\n    assets:checking  *1\n');
      expect(result.accounts.has('budget:food')).toBe(true);
      expect(result.accounts.has('assets:checking')).toBe(true);
    });

    test('should extract commodities from multiplier amounts', () => {
      const result = parse('= expenses:food\n    budget:food  *$2\n');
      expect(result.commodities.has('$')).toBe(true);
    });

    test('should extract commodities from regular amounts', () => {
      const result = parse('= expenses:food\n    budget:food    $50\n');
      expect(result.commodities.has('$')).toBe(true);
    });

    test('should not pollute transactions or periodicTransactions arrays', () => {
      const result = parse('= expenses:food\n    budget:food  *-1\n');
      expect(result.transactions).toHaveLength(0);
      expect(result.periodicTransactions).toHaveLength(0);
    });

    test('should not treat = as a directive', () => {
      const result = parse('= expenses:food\n    budget:food  *-1\n');
      const equalsDirectives = result.directives.filter(d => d.value.startsWith('expenses:food'));
      expect(equalsDirectives).toHaveLength(0);
    });

    test('should set sourceUri on auto postings', () => {
      const result = parse('= expenses:food\n    budget:food  *-1\n');
      expect(result.autoPostings[0].sourceUri).toBeDefined();
      expect(result.autoPostings[0].sourceUri?.toString()).toBe('file:///test.journal');
    });

    test('should handle auto posting followed by regular transaction without blank line', () => {
      const content = [
        '= expenses:food',
        '    budget:food  *-1',
        '2024-01-01 Test',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n');
      const result = parse(content);
      expect(result.autoPostings).toHaveLength(1);
      expect(result.transactions).toHaveLength(1);
    });

    test('should extract tags from auto postings', () => {
      const result = parse('= expenses:food  ; type:auto\n    budget:food  *-1\n');
      expect(result.tags.has('type')).toBe(true);
    });
  });
});
