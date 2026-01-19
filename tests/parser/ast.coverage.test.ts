/**
 * Additional tests for ast.ts to improve coverage
 * Targets uncovered lines: 46, 537, 544, 611, 613, 615, 703, 823-824, 832, 858-860, 873-876, 896-898
 */
import {
  addAccount,
  addPayee,
  addCommodity,
  addTag,
  processCommodityDirective,
  parseFormat
} from '../../src/parser/ast';
import { Account, Payee, Commodity, Tag, Format } from '../../src/types';
import { URI } from 'vscode-uri';

describe('AST - Coverage Tests', () => {
  describe('addAccount', () => {
    test('should update existing undeclared account to declared', () => {
      const accountMap = new Map<string, Account>();
      const sourceUri = URI.parse('file:///test.journal');

      // First add as undeclared
      addAccount(accountMap, 'Assets:Bank', false, undefined, undefined);

      expect(accountMap.get('Assets:Bank')?.declared).toBe(false);

      // Then add as declared - should update existing
      addAccount(accountMap, 'Assets:Bank', true, sourceUri, 5);

      const account = accountMap.get('Assets:Bank');
      expect(account?.declared).toBe(true);
      expect(account?.sourceUri).toBe(sourceUri);
      expect(account?.line).toBe(5);
    });

    test('should not update already declared account', () => {
      const accountMap = new Map<string, Account>();
      const sourceUri1 = URI.parse('file:///first.journal');
      const sourceUri2 = URI.parse('file:///second.journal');

      // First add as declared
      addAccount(accountMap, 'Assets:Bank', true, sourceUri1, 10);

      // Then try to add again as declared from different location
      addAccount(accountMap, 'Assets:Bank', true, sourceUri2, 20);

      const account = accountMap.get('Assets:Bank');
      // Should keep original declaration info
      expect(account?.sourceUri).toBe(sourceUri1);
      expect(account?.line).toBe(10);
    });

    test('should add new account with sourceUri', () => {
      const accountMap = new Map<string, Account>();
      const sourceUri = URI.parse('file:///test.journal');

      addAccount(accountMap, 'Expenses:Food', true, sourceUri, 15);

      const account = accountMap.get('Expenses:Food');
      expect(account?.name).toBe('Expenses:Food');
      expect(account?.declared).toBe(true);
      expect(account?.sourceUri).toBe(sourceUri);
      expect(account?.line).toBe(15);
    });
  });

  describe('addPayee', () => {
    test('should update existing undeclared payee to declared (lines 858-860)', () => {
      const payeeMap = new Map<string, Payee>();
      const sourceUri = URI.parse('file:///test.journal');

      // First add as undeclared
      addPayee(payeeMap, 'Grocery Store', false, undefined, undefined);

      expect(payeeMap.get('Grocery Store')?.declared).toBe(false);

      // Then add as declared - should update existing
      addPayee(payeeMap, 'Grocery Store', true, sourceUri, 3);

      const payee = payeeMap.get('Grocery Store');
      expect(payee?.declared).toBe(true);
      expect(payee?.sourceUri).toBe(sourceUri);
      expect(payee?.line).toBe(3);
    });

    test('should not update already declared payee', () => {
      const payeeMap = new Map<string, Payee>();
      const sourceUri = URI.parse('file:///test.journal');

      addPayee(payeeMap, 'Store', true, sourceUri, 5);
      addPayee(payeeMap, 'Store', true, URI.parse('file:///other.journal'), 10);

      const payee = payeeMap.get('Store');
      expect(payee?.line).toBe(5);
    });
  });

  describe('addCommodity', () => {
    test('should update existing undeclared commodity to declared (lines 873-876)', () => {
      const commodityMap = new Map<string, Commodity>();
      const sourceUri = URI.parse('file:///test.journal');
      const format: Format = { symbol: '$', symbolOnLeft: true };

      // First add as undeclared
      addCommodity(commodityMap, '$', false, undefined, undefined, undefined);

      expect(commodityMap.get('$')?.declared).toBe(false);

      // Then add as declared with format
      addCommodity(commodityMap, '$', true, format, sourceUri, 1);

      const commodity = commodityMap.get('$');
      expect(commodity?.declared).toBe(true);
      expect(commodity?.format).toEqual(format);
      expect(commodity?.sourceUri).toBe(sourceUri);
      expect(commodity?.line).toBe(1);
    });

    test('should update undeclared commodity format with better precision', () => {
      const commodityMap = new Map<string, Commodity>();

      // First add with low precision
      addCommodity(commodityMap, 'EUR', false, { precision: 2 }, undefined, undefined);

      // Then add with higher precision
      addCommodity(commodityMap, 'EUR', false, { precision: 4 }, undefined, undefined);

      const commodity = commodityMap.get('EUR');
      expect(commodity?.format?.precision).toBe(4);
    });

    test('should not overwrite undeclared format if existing has better precision', () => {
      const commodityMap = new Map<string, Commodity>();

      // First add with high precision
      addCommodity(commodityMap, 'EUR', false, { precision: 4 }, undefined, undefined);

      // Then add with lower precision
      addCommodity(commodityMap, 'EUR', false, { precision: 2 }, undefined, undefined);

      const commodity = commodityMap.get('EUR');
      expect(commodity?.format?.precision).toBe(4);
    });

    test('should update format when existing has null precision', () => {
      const commodityMap = new Map<string, Commodity>();

      // First add with null precision
      addCommodity(commodityMap, 'BTC', false, { precision: null }, undefined, undefined);

      // Then add with actual precision
      addCommodity(commodityMap, 'BTC', false, { precision: 8 }, undefined, undefined);

      const commodity = commodityMap.get('BTC');
      expect(commodity?.format?.precision).toBe(8);
    });

    test('should add format when existing has no format', () => {
      const commodityMap = new Map<string, Commodity>();

      // First add without format
      addCommodity(commodityMap, 'GBP', false, undefined, undefined, undefined);

      // Then add with format
      addCommodity(commodityMap, 'GBP', false, { precision: 2, symbolOnLeft: true }, undefined, undefined);

      const commodity = commodityMap.get('GBP');
      expect(commodity?.format?.precision).toBe(2);
    });
  });

  describe('addTag', () => {
    test('should update existing undeclared tag to declared (lines 896-898)', () => {
      const tagMap = new Map<string, Tag>();
      const sourceUri = URI.parse('file:///test.journal');

      // First add as undeclared
      addTag(tagMap, 'project', false, undefined, undefined);

      expect(tagMap.get('project')?.declared).toBe(false);

      // Then add as declared
      addTag(tagMap, 'project', true, sourceUri, 2);

      const tag = tagMap.get('project');
      expect(tag?.declared).toBe(true);
      expect(tag?.sourceUri).toBe(sourceUri);
      expect(tag?.line).toBe(2);
    });

    test('should not update already declared tag', () => {
      const tagMap = new Map<string, Tag>();
      const sourceUri = URI.parse('file:///test.journal');

      addTag(tagMap, 'client', true, sourceUri, 5);
      addTag(tagMap, 'client', true, URI.parse('file:///other.journal'), 10);

      const tag = tagMap.get('client');
      expect(tag?.line).toBe(5);
    });
  });

  describe('processCommodityDirective', () => {
    test('should process simple commodity directive', () => {
      const commodityMap = new Map<string, Commodity>();
      const lines = ['commodity $'];
      const sourceUri = URI.parse('file:///test.journal');

      // Returns the last line index processed
      const lastLineProcessed = processCommodityDirective(lines, 0, commodityMap, sourceUri);

      expect(lastLineProcessed).toBe(0); // Single line, returns 0
      expect(commodityMap.has('$')).toBe(true);
      expect(commodityMap.get('$')?.declared).toBe(true);
    });

    test('should process commodity with format subdirective', () => {
      const commodityMap = new Map<string, Commodity>();
      const lines = [
        'commodity USD',
        '  format 1,000.00 USD'
      ];
      const sourceUri = URI.parse('file:///test.journal');

      const lastLineProcessed = processCommodityDirective(lines, 0, commodityMap, sourceUri);

      expect(lastLineProcessed).toBe(1); // Processed both lines
      expect(commodityMap.has('USD')).toBe(true);
    });

    test('should process commodity with format sample', () => {
      const commodityMap = new Map<string, Commodity>();
      const lines = ['commodity $1,000.00'];
      const sourceUri = URI.parse('file:///test.journal');

      const lastLineProcessed = processCommodityDirective(lines, 0, commodityMap, sourceUri);

      expect(lastLineProcessed).toBe(0);
      expect(commodityMap.has('$')).toBe(true);
      const commodity = commodityMap.get('$');
      if (commodity?.format) {
        expect(commodity.format.precision).toBe(2);
      }
    });

    test('should handle commodity directive at non-zero start line', () => {
      const commodityMap = new Map<string, Commodity>();
      const lines = [
        'some other line',
        'commodity EUR',
        'another line'
      ];
      const sourceUri = URI.parse('file:///test.journal');

      const lastLineProcessed = processCommodityDirective(lines, 1, commodityMap, sourceUri);

      expect(lastLineProcessed).toBe(1); // Returns 1 since no subdirectives
      expect(commodityMap.has('EUR')).toBe(true);
    });
  });

  describe('parseFormat edge cases', () => {
    test('should handle multiple dots as thousands separator (line 537)', () => {
      // Number like 1.000.000 - multiple dots indicate thousands separator
      const result = parseFormat('$1.000.000');

      expect(result).not.toBeNull();
      if (result?.format) {
        // Multiple dots should be detected as thousands separator
        expect(result.format.thousandsSeparator).toBe('.');
      }
    });

    test('should handle multiple commas as thousands separator (line 544)', () => {
      // Number like 1,000,000 - multiple commas indicate thousands separator
      const result = parseFormat('$1,000,000');

      expect(result).not.toBeNull();
      if (result?.format) {
        expect(result.format.thousandsSeparator).toBe(',');
      }
    });

    test('should handle European format with comma decimal', () => {
      // European format: 1.000,00
      const result = parseFormat('EUR 1.000,00');

      expect(result).not.toBeNull();
      if (result?.format) {
        expect(result.format.decimalMark).toBe(',');
        expect(result.format.thousandsSeparator).toBe('.');
      }
    });

    test('should handle number with no separators', () => {
      const result = parseFormat('$100');

      expect(result).not.toBeNull();
      // No decimal point means precision is null
      if (result?.format) {
        expect(result.format.precision).toBeNull();
      }
    });

    test('should handle space as thousands separator', () => {
      const result = parseFormat('1 000 000.00 EUR');

      expect(result).not.toBeNull();
      if (result?.format) {
        expect(result.format.thousandsSeparator).toBe(' ');
      }
    });
  });
});
