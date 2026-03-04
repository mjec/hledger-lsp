import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as ast from '../../src/parser/ast';

describe('Periodic Transaction Parsing', () => {
  const parser = new HledgerParser();

  function parse(content: string) {
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    return parser.parse(doc);
  }

  describe('parsePeriodicTransaction (ast)', () => {
    test('should parse basic periodic transaction', () => {
      const lines = ['~ monthly', '    expenses:rent    $1500', '    assets:checking'];
      const result = ast.parsePeriodicTransaction(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.periodExpression).toBe('monthly');
      expect(result!.description).toBe('');
      expect(result!.postings).toHaveLength(2);
      expect(result!.postings[0].account).toBe('expenses:rent');
      expect(result!.postings[0].amount?.quantity).toBe(1500);
      expect(result!.postings[0].amount?.commodity).toBe('$');
      expect(result!.postings[1].account).toBe('assets:checking');
    });

    test('should parse various period expressions', () => {
      const expressions = [
        'every 2 weeks',
        'quarterly',
        'yearly',
        'every 15th day of month',
        'every 2 months from 2024-01 to 2024-12',
      ];
      for (const expr of expressions) {
        const lines = [`~ ${expr}`, '    expenses:test    $100', '    assets:checking'];
        const result = ast.parsePeriodicTransaction(lines, 0);
        expect(result).not.toBeNull();
        expect(result!.periodExpression).toBe(expr);
      }
    });

    test('should parse description after double-space', () => {
      const lines = ['~ monthly  set budget goals', '    expenses:rent    $1500', '    assets:checking'];
      const result = ast.parsePeriodicTransaction(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.periodExpression).toBe('monthly');
      expect(result!.description).toBe('set budget goals');
    });

    test('should parse with comment and tags', () => {
      const lines = ['~ monthly  ; priority:high', '    expenses:rent    $1500', '    assets:checking'];
      const result = ast.parsePeriodicTransaction(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.comment).toBe('priority:high');
      expect(result!.tags).toEqual({ priority: 'high' });
    });

    test('should infer missing amount', () => {
      const lines = ['~ monthly', '    expenses:rent    $1500', '    assets:checking'];
      const result = ast.parsePeriodicTransaction(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.postings[1].amount).toBeDefined();
      expect(result!.postings[1].amount?.quantity).toBe(-1500);
      expect(result!.postings[1].amount?.inferred).toBe(true);
    });

    test('should parse empty periodic transaction (no postings)', () => {
      const lines = ['~ monthly'];
      const result = ast.parsePeriodicTransaction(lines, 0);
      expect(result).not.toBeNull();
      expect(result!.postings).toHaveLength(0);
    });

    test('should set correct line numbers', () => {
      const lines = ['~ monthly', '    expenses:rent    $1500', '    assets:checking'];
      const result = ast.parsePeriodicTransaction(lines, 5);
      expect(result).not.toBeNull();
      expect(result!.line).toBe(5);
      expect(result!.postings[0].line).toBe(6);
      expect(result!.postings[1].line).toBe(7);
    });

    test('should return null for non-periodic line', () => {
      const result = ast.parsePeriodicTransaction(['not a periodic'], 0);
      expect(result).toBeNull();
    });
  });

  describe('integration via HledgerParser', () => {
    test('should parse single periodic transaction', () => {
      const result = parse('~ monthly\n    expenses:rent    $1500\n    assets:checking\n');
      expect(result.periodicTransactions).toHaveLength(1);
      expect(result.periodicTransactions[0].periodExpression).toBe('monthly');
      expect(result.periodicTransactions[0].postings).toHaveLength(2);
      expect(result.transactions).toHaveLength(0);
    });

    test('should parse multiple periodic transactions', () => {
      const content = [
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
        '',
        '~ weekly',
        '    expenses:groceries    $200',
        '    assets:checking',
      ].join('\n');
      const result = parse(content);
      expect(result.periodicTransactions).toHaveLength(2);
      expect(result.periodicTransactions[0].periodExpression).toBe('monthly');
      expect(result.periodicTransactions[1].periodExpression).toBe('weekly');
    });

    test('should parse mixed with regular transactions', () => {
      const content = [
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
        '',
        '2024-01-01 Grocery Store',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n');
      const result = parse(content);
      expect(result.periodicTransactions).toHaveLength(1);
      expect(result.transactions).toHaveLength(1);
      expect(result.periodicTransactions[0].periodExpression).toBe('monthly');
      expect(result.transactions[0].description).toBe('Grocery Store');
    });

    test('should extract accounts into accounts map', () => {
      const result = parse('~ monthly\n    expenses:rent    $1500\n    assets:checking\n');
      expect(result.accounts.has('expenses:rent')).toBe(true);
      expect(result.accounts.has('assets:checking')).toBe(true);
    });

    test('should extract commodities into commodities map', () => {
      const result = parse('~ monthly\n    expenses:rent    $1500\n    assets:checking\n');
      expect(result.commodities.has('$')).toBe(true);
    });

    test('should extract tags into tags map', () => {
      const result = parse('~ monthly  ; priority:high\n    expenses:rent    $1500\n    assets:checking\n');
      expect(result.tags.has('priority')).toBe(true);
    });

    test('should not pollute transactions array', () => {
      const result = parse('~ monthly\n    expenses:rent    $1500\n    assets:checking\n');
      expect(result.transactions).toHaveLength(0);
    });

    test('should handle periodic transaction followed by regular transaction without blank line', () => {
      const content = [
        '~ monthly',
        '    expenses:rent    $1500',
        '    assets:checking',
        '2024-01-01 Test',
        '    expenses:food    $50',
        '    assets:checking',
      ].join('\n');
      const result = parse(content);
      expect(result.periodicTransactions).toHaveLength(1);
      expect(result.transactions).toHaveLength(1);
    });

    test('should handle periodic transaction with comments between postings', () => {
      const content = [
        '~ monthly',
        '    ; this is rent',
        '    expenses:rent    $1500',
        '    assets:checking',
      ].join('\n');
      const result = parse(content);
      expect(result.periodicTransactions).toHaveLength(1);
      expect(result.periodicTransactions[0].postings).toHaveLength(2);
    });

    test('should set sourceUri on periodic transactions', () => {
      const result = parse('~ monthly\n    expenses:rent    $1500\n    assets:checking\n');
      expect(result.periodicTransactions[0].sourceUri).toBeDefined();
      expect(result.periodicTransactions[0].sourceUri?.toString()).toBe('file:///test.journal');
    });
  });
});
