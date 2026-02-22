import { URI } from 'vscode-uri';
import { Validator } from '../../src/features/validator';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver/node';

describe('Validator', () => {
  let validator: Validator;
  let parser: HledgerParser;

  beforeEach(() => {
    validator = new Validator();
    parser = new HledgerParser();
  });

  describe('balance validation', () => {
    test('should accept balanced transaction', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should detect unbalanced transaction', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-40.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors.length).toBeGreaterThan(0);
      expect(balanceErrors[0].severity).toBe(DiagnosticSeverity.Error);
      expect(balanceErrors[0].message).toContain('10.00');
    });

    test('should handle multi-currency transactions', () => {
      const content = `2024-01-15 * Currency Exchange
    assets:usd  $100.00
    assets:eur  €-90.00
    equity:conversion`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // Multi-currency transactions with a missing amount are valid
      // The missing amount balances the transaction
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should detect unbalanced multi-currency transaction', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    expenses:food  €20.00
    assets:checking  $-40.00
    assets:checking  €-20.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors.length).toBeGreaterThan(0);
      expect(balanceErrors[0].message).toContain('$');
    });

    test('should allow transaction with one missing amount', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // Should not have balance errors because one amount is missing (inferred)
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should report error on correct transaction when duplicates have same description', () => {
      const content = `2024-04-01 Test Transaction
    Equity:Opening                              -10.00
    Assets:Cash                                  10.00

2024-04-01 Test Transaction
    Assets:Cash                                  -1.00
    Expenses:Food                                 2.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(1);
      // Error should be on line 4 (the second transaction), not line 0 (the first)
      expect(balanceErrors[0].range.start.line).toBe(4);
    });

    test('should handle floating point precision', () => {
      const content = `2024-01-15 * Store
    expenses:food  $33.33
    expenses:tax  $3.34
    assets:checking  $-36.67`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // Should accept small rounding differences
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });
  });

  describe('cost notation validation', () => {
    test('should validate balanced transaction with unit cost (@)', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @ $1.35
    assets:dollars  $-135`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should validate balanced transaction with total cost (@@)', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @@ $135
    assets:dollars  $-135`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should detect unbalanced transaction with unit cost', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @ $1.35
    assets:dollars  $-130`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors.length).toBeGreaterThan(0);
      expect(balanceErrors[0].message).toContain('$5.00 off');
    });

    test('should detect unbalanced transaction with total cost', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @@ $135
    assets:dollars  $-130`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors.length).toBeGreaterThan(0);
      expect(balanceErrors[0].message).toContain('$5 off');
    });

    test('should validate balanced transaction with @@ total cost and negative amount', () => {
      const content = `2026-01-01 Opening balances
    Assets:Investments                            10 FUND @@ 1000 USD
    Equity:OpeningBalances                       -10 FUND @@ 1000 USD`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should detect unbalanced transaction with @@ and double negative', () => {
      // 10 FUND @@ 1000 USD → sign(10) * 1000 = +1000 USD
      // -10 FUND @@ -1000 USD → sign(-10) * -1000 = +1000 USD
      // Both postings contribute +1000 USD, so the transaction is unbalanced
      const content = `2026-01-01 Opening balances
    Assets:Investments2                            10 FUND @@ 1000 USD
    Equity:OpeningBalances2                       -10 FUND @@ -1000 USD`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors.length).toBeGreaterThan(0);
    });

    test('should validate transaction with multiple costs', () => {
      const content = `2009-01-01 Stock Purchase
    assets:stock1    10 AAPL @ $150
    assets:stock2    5 GOOG @ $100
    assets:cash     $-2000`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should validate balance assertion with cost notation', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @ $1.35 = €100
    assets:dollars  $-135`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should detect failed balance assertion with cost notation', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100 @ $1.35 = €90
    assets:dollars  $-135`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors.length).toBeGreaterThan(0);
    });

    test('should track balance assertions in original commodity with costs', () => {
      const content = `2009-01-01 Initial Purchase
    assets:euros     €100 @ $1.35 = €100
    assets:dollars  $-135

2009-01-02 Second Purchase
    assets:euros     €50 @ $1.40 = €150
    assets:dollars  $-70`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should handle negative amounts with cost', () => {
      const content = `2009-01-01 Currency Sell
    assets:euros     €-100 @ $1.35
    assets:dollars  $135`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should handle cost with decimal precision', () => {
      const content = `2009-01-01 Stock Purchase
    assets:stock     100 SHARES @ $12.345
    assets:cash     $-1234.50`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });
  });

  describe('inferred cost validation', () => {
    test('should validate inferred cost balances transaction', () => {
      const content = `2009-01-01 Currency Exchange
    assets:euros     €100
    assets:dollars  $-135`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should not infer cost for unbalanced multi-commodity transaction (3+ commodities)', () => {
      const content = `2009-01-01 Three Commodities
    assets:euros     €100
    assets:dollars  $-130
    assets:pounds    £10`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // With 3 commodities, no cost is inferred, so transaction doesn't balance
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors.length).toBeGreaterThan(0);
    });

    test('should validate inferred cost with multiple postings', () => {
      const content = `2009-01-01 Split Payment
    assets:euros     €100
    assets:dollars  $-100
    assets:dollars  $-35`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });

    test('should validate balance assertions with inferred costs', () => {
      const content = `2009-01-01 Initial Purchase
    assets:euros     €100 = €100
    assets:dollars  $-135

2009-01-02 Second Purchase
    assets:euros     €50 = €150
    assets:dollars  $-70`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should handle swapped commodity order in inferred costs', () => {
      const content = `2009-01-01 Transaction
    assets:dollars  $-135
    assets:euros     €100`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors).toHaveLength(0);
    });
  });

  describe('missing amounts validation', () => {
    test('should allow one posting without amount', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const amountErrors = result.diagnostics.filter(d => d.message.includes('without amounts'));
      expect(amountErrors).toHaveLength(0);
    });

    test('should detect multiple postings without amounts', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food
    assets:checking
    liabilities:credit`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const amountErrors = result.diagnostics.filter(d => d.message.includes('without amounts'));
      expect(amountErrors.length).toBeGreaterThan(0);
      expect(amountErrors[0].severity).toBe(DiagnosticSeverity.Error);
      expect(amountErrors[0].message).toContain('3 postings');
    });

    test('should allow all postings with amounts', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const amountErrors = result.diagnostics.filter(d => d.message.includes('without amounts'));
      expect(amountErrors).toHaveLength(0);
    });
  });

  describe('undeclared items validation', () => {
    test('should not warn about declared accounts', () => {
      const content = `account assets:checking
account expenses:food

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const accountWarnings = result.diagnostics.filter(d => d.message.includes('Account') && d.message.includes('not declared'));
      expect(accountWarnings).toHaveLength(0);
    });

    test('should warn about undeclared accounts', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const accountWarnings = result.diagnostics.filter(d => d.message.includes('Account') && d.message.includes('not declared'));
      expect(accountWarnings.length).toBeGreaterThan(0);
      expect(accountWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
    });

    test('should not warn about declared payees', () => {
      const content = `payee Grocery Store

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const payeeWarnings = result.diagnostics.filter(d => d.message.includes('Payee') && d.message.includes('not declared'));
      expect(payeeWarnings).toHaveLength(0);
    });

    test('should warn about undeclared payees when enabled', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc, {
        settings: {
          validation: {
            undeclaredPayees: true
          }
        }
      });

      const payeeWarnings = result.diagnostics.filter(d => d.message.includes('Payee') && d.message.includes('not declared'));
      expect(payeeWarnings.length).toBeGreaterThan(0);
      expect(payeeWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
      expect(payeeWarnings[0].message).toContain('Grocery Store');
    });

    test('should NOT warn about undeclared payees by default', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const payeeWarnings = result.diagnostics.filter(d => d.message.includes('Payee') && d.message.includes('not declared'));
      expect(payeeWarnings).toHaveLength(0);
    });

    test('should not warn about declared commodities', () => {
      const content = `commodity $

2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const commodityWarnings = result.diagnostics.filter(d => d.message.includes('Commodity') && d.message.includes('not declared'));
      expect(commodityWarnings).toHaveLength(0);
    });

    test('should warn about undeclared commodities', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const commodityWarnings = result.diagnostics.filter(d => d.message.includes('Commodity') && d.message.includes('not declared'));
      expect(commodityWarnings.length).toBeGreaterThan(0);
      expect(commodityWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
      expect(commodityWarnings[0].message).toContain('$');
    });

    test('should not warn about declared tags', () => {
      const content = `tag trip

2024-01-15 * Hotel ; trip:paris
    expenses:lodging  $100.00
    assets:checking  $-100.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const tagWarnings = result.diagnostics.filter(d => d.message.includes('Tag') && d.message.includes('not declared'));
      expect(tagWarnings).toHaveLength(0);
    });

    test('should warn about undeclared tags', () => {
      const content = `2024-01-15 * Hotel ; trip:paris
    expenses:lodging  $100.00
    assets:checking  $-100.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc, {
        settings: {
          validation: {
            undeclaredTags: true
          }
        }
      });

      const tagWarnings = result.diagnostics.filter(d => d.message.includes('Tag') && d.message.includes('not declared'));
      expect(tagWarnings.length).toBeGreaterThan(0);
      expect(tagWarnings[0].severity).toBe(DiagnosticSeverity.Information);
      expect(tagWarnings[0].message).toContain('trip');
    });

    test('should warn about undeclared posting-level tags', () => {
      const content = `2024-01-15 * Hotel
    expenses:lodging  $100.00 ; trip:paris
    assets:checking  $-100.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc, {
        settings: {
          validation: {
            undeclaredTags: true
          }
        }
      });

      const tagWarnings = result.diagnostics.filter(d => d.message.includes('Tag') && d.message.includes('not declared'));
      expect(tagWarnings.length).toBeGreaterThan(0);
      expect(tagWarnings[0].severity).toBe(DiagnosticSeverity.Information);
      expect(tagWarnings[0].message).toContain('trip');
    });
    test('should warn about all instances of undeclared items by default', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-16 * Grocery Store
    expenses:food  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const accountWarnings = result.diagnostics.filter(d => d.message.includes('Account') && d.message.includes('not declared'));
      // expenses:food (2) + assets:checking (2) = 4 warnings
      expect(accountWarnings).toHaveLength(4);
    });

    test('should warn about only first instance when markAllUndeclaredInstances is false', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-16 * Grocery Store
    expenses:food  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc, {
        settings: {
          validation: {
            markAllUndeclaredInstances: false
          }
        }
      });

      const accountWarnings = result.diagnostics.filter(d => d.message.includes('Account') && d.message.includes('not declared'));
      // expenses:food (1) + assets:checking (1) = 2 warnings
      expect(accountWarnings).toHaveLength(2);
    });

    test('should respect custom severity settings', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc, {
        settings: {
          severity: {
            undeclaredAccounts: 'error'
          }
        }
      });

      const accountWarnings = result.diagnostics.filter(d => d.message.includes('Account') && d.message.includes('not declared'));
      expect(accountWarnings).toHaveLength(2);
      expect(accountWarnings[0].severity).toBe(DiagnosticSeverity.Error);
    });
  });

  describe('multiple validations', () => {
    test('should report multiple errors in same document', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-40.00

2024-01-16 * Gas Station
    expenses:auto
    assets:checking
    liabilities:credit`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // Should have balance error for first transaction
      const balanceErrors = result.diagnostics.filter(d => d.message.includes('does not balance'));
      expect(balanceErrors.length).toBeGreaterThan(0);

      // Should have missing amounts error for second transaction
      const amountErrors = result.diagnostics.filter(d => d.message.includes('without amounts'));
      expect(amountErrors.length).toBeGreaterThan(0);
    });

    test('should validate empty document without errors', () => {
      const content = ``;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      expect(result.diagnostics).toHaveLength(0);
    });

    test('should validate document with only comments', () => {
      const content = `; This is a comment
# Another comment`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('date ordering validation', () => {
    test('should accept transactions in chronological order', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-16 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00

2024-01-17 * Store C
    expenses:food  $20.00
    assets:checking  $-20.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateWarnings = result.diagnostics.filter(d => d.message.includes('before previous transaction'));
      expect(dateWarnings).toHaveLength(0);
    });

    test('should warn about out-of-order transactions', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-17 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00

2024-01-16 * Store C
    expenses:food  $20.00
    assets:checking  $-20.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateWarnings = result.diagnostics.filter(d => d.message.includes('before previous transaction'));
      expect(dateWarnings.length).toBeGreaterThan(0);
      expect(dateWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
      expect(dateWarnings[0].message).toContain('2024-01-16');
      expect(dateWarnings[0].message).toContain('2024-01-17');
    });

    test('should accept transactions with same date', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-15 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateWarnings = result.diagnostics.filter(d => d.message.includes('before previous transaction'));
      expect(dateWarnings).toHaveLength(0);
    });

    test('should handle slash-separated dates', () => {
      const content = `2024/01/15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00

2024/01/14 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateWarnings = result.diagnostics.filter(d => d.message.includes('before previous transaction'));
      expect(dateWarnings.length).toBeGreaterThan(0);
    });

    test('should handle multiple out-of-order transactions', () => {
      const content = `2024-01-20 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-15 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00

2024-01-10 * Store C
    expenses:food  $20.00
    assets:checking  $-20.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateWarnings = result.diagnostics.filter(d => d.message.includes('before previous transaction'));
      expect(dateWarnings.length).toBe(2);
    });
  });

  describe('balance assertion validation', () => {
    test('should accept correct balance assertion', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00 = $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should detect incorrect balance assertion', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00 = $1000.00

2024-01-16 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00 = $950.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors.length).toBeGreaterThan(0);
      expect(assertionErrors[0].severity).toBe(DiagnosticSeverity.Error);
      expect(assertionErrors[0].message).toContain('assets:checking');
    });

    test('should track balances across multiple transactions', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-16 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00 = $-80.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });


    test('should accept correct balance assertions on out of order transactions', () => {
      const content = `2024-01-16 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00 = $-80.00

2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should detect incorrect balance assertions on out of order transactions but same day', () => {
      const content = `2024-01-15 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00 = $-80.00

2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00
`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(1);
    });

    test('should accept correct balances across multiple transactions on the same day', () => {
      const content = `2024-01-15 * Store A
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-15 * Store B
    expenses:food  $30.00
    assets:checking  $-30.00 = $-80.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should handle multiple commodities in assertions', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:usd  $-50.00 = $-50.00

2024-01-16 * Store
    expenses:food  €30.00
    assets:eur  €-30.00 = €-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should detect assertion failure with wrong commodity', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00

2024-01-16 * Store
    expenses:food  €30.00
    assets:checking  €-30.00 = €-40.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors.length).toBeGreaterThan(0);
    });

    test('should handle floating point precision in assertions', () => {
      const content = `2024-01-15 * Store
    expenses:food  $33.33
    assets:checking  $-33.33

2024-01-16 * Store
    expenses:food  $33.34
    assets:checking  $-33.34 = $-66.67`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should handle assertions on accounts with no prior balance', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00 = $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors).toHaveLength(0);
    });

    test('should detect multiple assertion failures', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00 = $100.00

2024-01-16 * Store
    expenses:food  $30.00
    assets:checking  $-30.00 = $200.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
      expect(assertionErrors.length).toBe(2);
    });
  });

  describe('empty transaction validation', () => {
    test('should accept transactions with 2 postings', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const emptyTxnErrors = result.diagnostics.filter(d => d.message.includes('minimum 2 required'));
      expect(emptyTxnErrors).toHaveLength(0);
    });

    test('should accept transactions with more than 2 postings', () => {
      const content = `2024-01-15 * Store
    expenses:food  $30.00
    expenses:tax  $5.00
    assets:checking  $-35.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const emptyTxnErrors = result.diagnostics.filter(d => d.message.includes('minimum 2 required'));
      expect(emptyTxnErrors).toHaveLength(0);
    });

    test('should detect transactions with only 1 posting', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const emptyTxnErrors = result.diagnostics.filter(d => d.message.includes('minimum 2 required'));
      expect(emptyTxnErrors.length).toBeGreaterThan(0);
      expect(emptyTxnErrors[0].severity).toBe(DiagnosticSeverity.Error);
      expect(emptyTxnErrors[0].message).toContain('1 posting');
    });

    test('should detect transactions with no postings', () => {
      const content = `2024-01-15 * Store`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const emptyTxnErrors = result.diagnostics.filter(d => d.message.includes('minimum 2 required'));
      expect(emptyTxnErrors.length).toBeGreaterThan(0);
      expect(emptyTxnErrors[0].message).toContain('0 posting');
    });
  });

  describe('invalid date format validation', () => {
    test('should accept valid dates', () => {
      const content = `2024-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00

2024/02/29 * Leap year
    expenses:food  $30.00
    assets:checking  $-30.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateErrors = result.diagnostics.filter(d => d.message.includes('Invalid'));
      expect(dateErrors).toHaveLength(0);
    });

    test('should detect invalid month', () => {
      const content = `2024-13-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateErrors = result.diagnostics.filter(d => d.message.includes('Invalid month'));
      expect(dateErrors.length).toBeGreaterThan(0);
      expect(dateErrors[0].severity).toBe(DiagnosticSeverity.Error);
    });

    test('should detect invalid day', () => {
      const content = `2024-01-32 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateErrors = result.diagnostics.filter(d => d.message.includes('Invalid day'));
      expect(dateErrors.length).toBeGreaterThan(0);
      expect(dateErrors[0].severity).toBe(DiagnosticSeverity.Error);
    });

    test('should detect dates that do not exist in calendar', () => {
      const content = `2024-02-30 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateErrors = result.diagnostics.filter(d => d.message.includes('does not exist in calendar'));
      expect(dateErrors.length).toBeGreaterThan(0);
      expect(dateErrors[0].severity).toBe(DiagnosticSeverity.Error);
    });

    test('should detect invalid dates in non-leap years', () => {
      const content = `2023-02-29 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateErrors = result.diagnostics.filter(d => d.message.includes('does not exist in calendar'));
      expect(dateErrors.length).toBeGreaterThan(0);
    });

    test('should detect month 00', () => {
      const content = `2024-00-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const dateErrors = result.diagnostics.filter(d => d.message.includes('Invalid month'));
      expect(dateErrors.length).toBeGreaterThan(0);
    });

    test('should handle dates correctly regardless of timezone (UTC parsing bug)', () => {
      // This test verifies that dates like 2025-05-01 are not incorrectly flagged
      // The bug occurs when parsing "YYYY-MM-DD" as UTC but validating with local time getters
      // In timezones west of UTC, this causes dates to shift to the previous day
      const content = `2025-05-01 * Test transaction
    expenses:food  $50.00
    assets:checking  $-50.00

2025-01-15 * Another test
    expenses:food  $30.00
    assets:checking  $-30.00

2025-12-31 * Year end
    expenses:food  $20.00
    assets:checking  $-20.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // These are all valid dates and should not produce "does not exist in calendar" errors
      const dateErrors = result.diagnostics.filter(d => d.message.includes('does not exist in calendar'));
      expect(dateErrors).toHaveLength(0);
    });
  });

  describe('future date validation', () => {
    test('should accept past dates', () => {
      const content = `2020-01-15 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const futureWarnings = result.diagnostics.filter(d => d.message.includes('in the future'));
      expect(futureWarnings).toHaveLength(0);
    });

    test('should accept today\'s date', () => {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const content = `${dateStr} * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const futureWarnings = result.diagnostics.filter(d => d.message.includes('in the future'));
      expect(futureWarnings).toHaveLength(0);
    });

    test('should warn about future dates', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const dateStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
      const content = `${dateStr} * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const futureWarnings = result.diagnostics.filter(d => d.message.includes('in the future'));
      expect(futureWarnings.length).toBeGreaterThan(0);
      expect(futureWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
    });

    test('should not warn if date is invalid', () => {
      const content = `2024-99-99 * Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // Should have invalid date error, not future date warning
      const futureWarnings = result.diagnostics.filter(d => d.message.includes('in the future'));
      expect(futureWarnings).toHaveLength(0);
    });
  });

  describe('empty description validation', () => {
    test('should accept transactions with descriptions', () => {
      const content = `2024-01-15 * Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const descWarnings = result.diagnostics.filter(d => d.message.includes('no description'));
      expect(descWarnings).toHaveLength(0);
    });

    test('should warn about empty descriptions', () => {
      const content = `2024-01-15 *
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const descWarnings = result.diagnostics.filter(d => d.message.includes('no description'));
      expect(descWarnings.length).toBeGreaterThan(0);
      expect(descWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
    });

    test('should warn about whitespace-only descriptions', () => {
      const content = `2024-01-15 *
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const descWarnings = result.diagnostics.filter(d => d.message.includes('no description'));
      expect(descWarnings.length).toBeGreaterThan(0);
    });

    test('should accept unmarked transactions with descriptions', () => {
      const content = `2024-01-15 Grocery Store
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const descWarnings = result.diagnostics.filter(d => d.message.includes('no description'));
      expect(descWarnings).toHaveLength(0);
    });
  });

  describe('include validation', () => {
    test('should detect missing include files', () => {
      const content = `include missing.journal

2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      // Create a mock fileReader that returns null for missing files
      const fileReader = (_uri: URI) => null;

      const result = validator.validate(doc, parsedDoc, {
        baseUri: URI.parse(doc.uri),
        fileReader
      });

      const includeErrors = result.diagnostics.filter(d => d.message.includes('Include file not found'));
      expect(includeErrors.length).toBeGreaterThan(0);
      expect(includeErrors[0].severity).toBe(DiagnosticSeverity.Error);
      expect(includeErrors[0].message).toContain('missing.journal');
    });

    test('should accept existing include files', () => {
      const content = `include existing.journal

2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      // Create a mock fileReader that returns a document for existing.journal
      const fileReader = (uri: URI) => {
        if (uri.toString().includes('existing.journal')) {
          return TextDocument.create(uri.toString(), 'hledger', 1, '');
        }
        return null;
      };

      const result = validator.validate(doc, parsedDoc, {
        baseUri: URI.parse(doc.uri),
        fileReader
      });

      const includeErrors = result.diagnostics.filter(d => d.message.includes('Include file not found'));
      expect(includeErrors).toHaveLength(0);
    });

    test('should detect duplicate includes', () => {
      const content = `include accounts.journal
include accounts.journal

2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      // Create a mock fileReader that returns a document
      const fileReader = (uri: URI) => {
        return TextDocument.create(uri.toString(), 'hledger', 1, '');
      };

      const result = validator.validate(doc, parsedDoc, {
        baseUri: URI.parse(doc.uri),
        fileReader
      });

      const duplicateWarnings = result.diagnostics.filter(d => d.message.includes('Duplicate include'));
      expect(duplicateWarnings.length).toBeGreaterThan(0);
      expect(duplicateWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
    });

    test('should detect circular includes (direct)', () => {
      const content = `include b.journal

2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///a.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      // Create a mock fileReader that simulates b.journal including a.journal
      const fileReader = (uri: URI) => {
        if (uri.toString().includes('b.journal')) {
          return TextDocument.create(uri.toString(), 'hledger', 1, 'include a.journal');
        }
        return null;
      };

      const result = validator.validate(doc, parsedDoc, {
        baseUri: URI.parse(doc.uri),
        fileReader
      });

      const circularErrors = result.diagnostics.filter(d => d.message.includes('Circular include'));
      expect(circularErrors.length).toBeGreaterThan(0);
      expect(circularErrors[0].severity).toBe(DiagnosticSeverity.Error);
    });

    test('should detect circular includes (indirect)', () => {
      const content = `include b.journal

2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///a.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      // Create a mock fileReader that simulates a->b->c->a
      const fileReader = (uri: URI) => {
        if (uri.toString().includes('b.journal')) {
          return TextDocument.create(uri.toString(), 'hledger', 1, 'include c.journal');
        } else if (uri.toString().includes('c.journal')) {
          return TextDocument.create(uri.toString(), 'hledger', 1, 'include a.journal');
        }
        return null;
      };

      const result = validator.validate(doc, parsedDoc, {
        baseUri: URI.parse(doc.uri),
        fileReader
      });

      const circularErrors = result.diagnostics.filter(d => d.message.includes('Circular include'));
      expect(circularErrors.length).toBeGreaterThan(0);
      expect(circularErrors[0].severity).toBe(DiagnosticSeverity.Error);
    });

    test('should not report false positives for non-circular includes', () => {
      const content = `include b.journal
include c.journal

2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///a.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      // Create a mock fileReader where files don't include each other
      const fileReader = (uri: URI) => {
        return TextDocument.create(uri.toString(), 'hledger', 1, '');
      };

      const result = validator.validate(doc, parsedDoc, {
        baseUri: URI.parse(doc.uri),
        fileReader
      });

      const circularErrors = result.diagnostics.filter(d => d.message.includes('Circular include'));
      expect(circularErrors).toHaveLength(0);
    });

    test('should work without ValidationOptions', () => {
      const content = `include test.journal

2024-01-15 * Test
    expenses:food  $50.00
    assets:checking  $-50.00`;
      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      // Validate without options - should not crash
      const result = validator.validate(doc, parsedDoc);

      // Should not have include validation diagnostics
      const includeErrors = result.diagnostics.filter(d =>
        d.message.includes('Include file') || d.message.includes('Circular include')
      );
      expect(includeErrors).toHaveLength(0);
    });

    test('should detect circular includes with multiple files', () => {
      const content = `include b.journal`;
      const doc = TextDocument.create('file:///a.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);

      const fileReader = (uri: URI) => {
        if (uri.toString().includes('b.journal')) return TextDocument.create(uri.toString(), 'hledger', 1, 'include c.journal');
        if (uri.toString().includes('c.journal')) return TextDocument.create(uri.toString(), 'hledger', 1, 'include a.journal');
        return null;
      };

      const result = validator.validate(doc, parsedDoc, {
        baseUri: URI.parse(doc.uri),
        fileReader
      });

      const circularErrors = result.diagnostics.filter(d => d.message.includes('Circular include'));
      expect(circularErrors.length).toBeGreaterThan(0);
    });
  });
});
