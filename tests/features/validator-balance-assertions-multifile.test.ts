/**
 * Tests for balance assertion validation across multiple files
 *
 * This test demonstrates that balance assertions must be validated
 * in chronological order (by date), not parse order, when transactions
 * come from multiple files via includes.
 */

import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';
import { Validator } from '../../src/features/validator';
import { FileReader } from '../../src/types';

describe('Validator - Balance Assertions Across Multiple Files', () => {
  let parser: HledgerParser;
  let validator: Validator;

  beforeEach(() => {
    parser = new HledgerParser();
    validator = new Validator();
  });

  test('should validate balance assertions in chronological order across files', () => {
    // Main file (main.journal) - has a transaction on 2024-01-15
    // and includes another file
    const mainContent = `
include expenses.journal

2024-01-15 Purchase
    expenses:food      $50
    assets:checking   $-50 = $945
`;

    // Included file (expenses.journal) - has earlier transaction on 2024-01-10
    const expensesContent = `
2024-01-10 Initial Balance
    assets:checking   $1000
    equity:opening

2024-01-12 Coffee
    expenses:food      $5
    assets:checking   $-5 = $995
`;

    const mainUri = URI.file('/test/main.journal');
    const expensesUri = URI.file('/test/expenses.journal');

    const mainDoc = TextDocument.create(mainUri.toString(), 'hledger', 1, mainContent);
    const expensesDoc = TextDocument.create(expensesUri.toString(), 'hledger', 1, expensesContent);

    const fileReader: FileReader = (uri: URI) => {
      if (uri.toString() === expensesUri.toString()) {
        return expensesDoc;
      }
      return null;
    };

    // Parse with includes
    const parsed = parser.parse(mainDoc, { fileReader });

    // Expected chronological order:
    // 1. 2024-01-10: checking = $1000 (from expenses.journal)
    // 2. 2024-01-12: checking = $995 (from expenses.journal)
    // 3. 2024-01-15: checking = $945 (from main.journal)
    //
    // All assertions should PASS if calculated in chronological order

    // Validate main.journal
    const mainResult = validator.validate(mainDoc, parsed);

    // The assertion on main.journal should pass (no diagnostics)
    const assertionErrors = mainResult.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(0);

    // Validate expenses.journal
    const parsedExpenses = parser.parse(expensesDoc, { fileReader });
    const expensesResult = validator.validate(expensesDoc, parsedExpenses);

    // The assertion on expenses.journal should also pass
    const expensesAssertionErrors = expensesResult.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(expensesAssertionErrors).toHaveLength(0);
  });

  test('should detect assertion failures in correct chronological order', () => {
    // Main file with transaction on 2024-01-15
    const mainContent = `
include expenses.journal

2024-01-15 Purchase
    expenses:food      $50
    assets:checking   $-50 = $999  ; WRONG! Should be $945
`;

    // Included file with earlier transactions
    const expensesContent = `
2024-01-10 Initial Balance
    assets:checking   $1000
    equity:opening

2024-01-12 Coffee
    expenses:food      $5
    assets:checking   $-5 = $995
`;

    const mainUri = URI.file('/test/main.journal');
    const expensesUri = URI.file('/test/expenses.journal');

    const mainDoc = TextDocument.create(mainUri.toString(), 'hledger', 1, mainContent);
    const expensesDoc = TextDocument.create(expensesUri.toString(), 'hledger', 1, expensesContent);

    const fileReader: FileReader = (uri: URI) => {
      if (uri.toString() === expensesUri.toString()) {
        return expensesDoc;
      }
      return null;
    };

    const parsed = parser.parse(mainDoc, { fileReader });
    const result = validator.validate(mainDoc, parsed);

    // Should have exactly one assertion error
    const assertionErrors = result.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(1);
    expect(assertionErrors[0].message).toContain('expected $999');
    expect(assertionErrors[0].message).toContain('calculated $945');
  });

  test('should handle assertions when transactions are parsed in reverse chronological order', () => {
    // This tests the edge case where the include comes AFTER the main transaction,
    // but the included file has EARLIER dated transactions

    const mainContent = `
2024-01-20 Late Transaction
    expenses:food      $10
    assets:checking   $-10 = $985

include early.journal
`;

    const earlyContent = `
2024-01-10 Initial Balance
    assets:checking   $1000
    equity:opening

2024-01-15 Middle Transaction
    expenses:food      $5
    assets:checking   $-5 = $995
`;

    const mainUri = URI.file('/test/main.journal');
    const earlyUri = URI.file('/test/early.journal');

    const mainDoc = TextDocument.create(mainUri.toString(), 'hledger', 1, mainContent);
    const earlyDoc = TextDocument.create(earlyUri.toString(), 'hledger', 1, earlyContent);

    const fileReader: FileReader = (uri: URI) => {
      if (uri.toString() === earlyUri.toString()) {
        return earlyDoc;
      }
      return null;
    };

    const parsed = parser.parse(mainDoc, { fileReader });
    const result = validator.validate(mainDoc, parsed);

    // No assertion errors - chronological order should be:
    // 1. 2024-01-10: $1000
    // 2. 2024-01-15: $995
    // 3. 2024-01-20: $985
    const assertionErrors = result.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(0);
  });

  test('should handle multiple commodities across files', () => {
    const mainContent = `
include stocks.journal

2024-01-20 Sell Stock
    assets:stocks     -10 AAPL = 40 AAPL
    assets:cash       $1500
`;

    const stocksContent = `
2024-01-10 Buy Stock
    assets:stocks     50 AAPL
    assets:cash       $-5000

2024-01-15 More Stock
    assets:stocks     0 AAPL = 50 AAPL
    assets:cash       $0
`;

    const mainUri = URI.file('/test/main.journal');
    const stocksUri = URI.file('/test/stocks.journal');

    const mainDoc = TextDocument.create(mainUri.toString(), 'hledger', 1, mainContent);
    const stocksDoc = TextDocument.create(stocksUri.toString(), 'hledger', 1, stocksContent);

    const fileReader: FileReader = (uri: URI) => {
      if (uri.toString() === stocksUri.toString()) {
        return stocksDoc;
      }
      return null;
    };

    const parsed = parser.parse(mainDoc, { fileReader });
    const result = validator.validate(mainDoc, parsed);

    // All assertions should pass
    const assertionErrors = result.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(0);
  });
});
