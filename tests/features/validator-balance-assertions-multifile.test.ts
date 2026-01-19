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
import { createTestWorkspace, IncludePathResolver } from '../helpers/workspaceTestHelper';
import { toFileUri } from '../../src/utils/uri';

describe('Validator - Balance Assertions Across Multiple Files', () => {
  let parser: HledgerParser;
  let validator: Validator;

  beforeEach(() => {
    parser = new HledgerParser();
    validator = new Validator();
  });

  test('should validate balance assertions in chronological order across files', async () => {
    const baseDir = '/test';

    const includeResolver: IncludePathResolver = (includePath, baseUri) => {
      if (includePath === 'expenses.journal') {
        return [toFileUri(`${baseDir}/expenses.journal`)];
      }
      return [];
    };

    const workspace = await createTestWorkspace({
      baseDir,
      files: {
        'main.journal': `
include expenses.journal

2024-01-15 Purchase
    expenses:food      $50
    assets:checking   $-50 = $945
`,
        'expenses.journal': `
2024-01-10 Initial Balance
    assets:checking   $1000
    equity:opening

2024-01-12 Coffee
    expenses:food      $5
    assets:checking   $-5 = $995
`
      },
      includePathResolver: includeResolver
    });

    // Parse with includes via workspace manager
    const parsed = workspace.parseFromFile('main.journal');
    const mainDoc = workspace.getDocument('main.journal')!;

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
    const expensesDoc = workspace.getDocument('expenses.journal')!;
    const parsedExpenses = workspace.parseFromFile('expenses.journal');
    const expensesResult = validator.validate(expensesDoc, parsedExpenses);

    // The assertion on expenses.journal should also pass
    const expensesAssertionErrors = expensesResult.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(expensesAssertionErrors).toHaveLength(0);
  });

  test('should detect assertion failures in correct chronological order', async () => {
    const baseDir = '/test';

    const includeResolver: IncludePathResolver = (includePath, baseUri) => {
      if (includePath === 'expenses.journal') {
        return [toFileUri(`${baseDir}/expenses.journal`)];
      }
      return [];
    };

    const workspace = await createTestWorkspace({
      baseDir,
      files: {
        'main.journal': `
include expenses.journal

2024-01-15 Purchase
    expenses:food      $50
    assets:checking   $-50 = $999  ; WRONG! Should be $945
`,
        'expenses.journal': `
2024-01-10 Initial Balance
    assets:checking   $1000
    equity:opening

2024-01-12 Coffee
    expenses:food      $5
    assets:checking   $-5 = $995
`
      },
      includePathResolver: includeResolver
    });

    const parsed = workspace.parseFromFile('main.journal');
    const mainDoc = workspace.getDocument('main.journal')!;

    const result = validator.validate(mainDoc, parsed);

    // Should detect the assertion failure on main.journal
    const assertionErrors = result.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(1);
    expect(assertionErrors[0].message).toContain('$999');
    expect(assertionErrors[0].message).toContain('$945');
  });

  test('should handle multiple balance assertions across multiple files', async () => {
    const baseDir = '/test';

    const includeResolver: IncludePathResolver = (includePath, baseUri) => {
      if (includePath === 'income.journal') {
        return [toFileUri(`${baseDir}/income.journal`)];
      }
      if (includePath === 'expenses.journal') {
        return [toFileUri(`${baseDir}/expenses.journal`)];
      }
      return [];
    };

    const workspace = await createTestWorkspace({
      baseDir,
      files: {
        'main.journal': `
include income.journal
include expenses.journal

2024-01-20 Grocery
    expenses:food      $30
    assets:checking   $-30 = $1165
`,
        'income.journal': `
2024-01-01 Salary
    assets:checking   $1200
    income:salary

2024-01-05 Bonus
    assets:checking   $100
    income:bonus
`,
        'expenses.journal': `
2024-01-10 Rent
    expenses:rent      $100
    assets:checking   $-100 = $1200

2024-01-15 Utilities
    expenses:utilities  $5
    assets:checking    $-5 = $1195
`
      },
      includePathResolver: includeResolver
    });

    const parsed = workspace.parseFromFile('main.journal');
    const mainDoc = workspace.getDocument('main.journal')!;

    // Expected chronological order:
    // 1. 2024-01-01: salary +1200 -> 1200
    // 2. 2024-01-05: bonus +100 -> 1300
    // 3. 2024-01-10: rent -100 -> 1200 (assertion: $1200) ✓
    // 4. 2024-01-15: utilities -5 -> 1195 (assertion: $1195) ✓
    // 5. 2024-01-20: grocery -30 -> 1165 (assertion: $1165) ✓

    const result = validator.validate(mainDoc, parsed);

    const assertionErrors = result.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(0);
  });

  test('should handle out-of-order dates correctly', async () => {
    const baseDir = '/test';

    const includeResolver: IncludePathResolver = (includePath, baseUri) => {
      if (includePath === 'later.journal') {
        return [toFileUri(`${baseDir}/later.journal`)];
      }
      return [];
    };

    // Main file has earlier date (2024-01-05) but is parsed first
    // Included file has later date (2024-01-10)
    const workspace = await createTestWorkspace({
      baseDir,
      files: {
        'main.journal': `
include later.journal

2024-01-01 Initial
    assets:checking   $1000
    equity:opening

2024-01-05 Purchase
    expenses:food      $50
    assets:checking   $-50 = $950
`,
        'later.journal': `
2024-01-10 Second Purchase
    expenses:food      $25
    assets:checking   $-25 = $925
`
      },
      includePathResolver: includeResolver
    });

    const parsed = workspace.parseFromFile('main.journal');
    const mainDoc = workspace.getDocument('main.journal')!;

    const result = validator.validate(mainDoc, parsed);

    const assertionErrors = result.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(0);
  });

  test('should validate same-day transactions across files', async () => {
    // NOTE: This test validates that same-day transactions from multiple files
    // are correctly merged and validated. The merge concatenates files in BFS
    // include order: main file transactions first, then included file transactions.
    // For same-day transactions, balance assertions must account for this order.
    const baseDir = '/test';

    const includeResolver: IncludePathResolver = (includePath, baseUri) => {
      if (includePath === 'morning.journal') {
        return [toFileUri(`${baseDir}/morning.journal`)];
      }
      return [];
    };

    // Merge order: main.journal txns, then morning.journal txns
    // So for same-day (2024-01-15): Evening first, then Morning Coffee, then Lunch
    // Balance progression: $1000 -> $970 (Evening) -> $965 (Coffee) -> $920 (Lunch)
    const workspace = await createTestWorkspace({
      baseDir,
      files: {
        'main.journal': `
include morning.journal

2024-01-01 Initial
    assets:checking   $1000
    equity:opening

2024-01-15 Evening
    expenses:dinner    $30
    assets:checking   $-30 = $970
`,
        'morning.journal': `
2024-01-15 Morning Coffee
    expenses:food      $5
    assets:checking   $-5 = $965

2024-01-15 Lunch
    expenses:food      $45
    assets:checking   $-45 = $920
`
      },
      includePathResolver: includeResolver
    });

    const parsed = workspace.parseFromFile('main.journal');
    const mainDoc = workspace.getDocument('main.journal')!;

    // Verify all 4 transactions are present
    expect(parsed.transactions.length).toBe(4);

    const result = validator.validate(mainDoc, parsed);

    const assertionErrors = result.diagnostics.filter(d =>
      d.message.includes('Balance assertion failed')
    );
    expect(assertionErrors).toHaveLength(0);
  });
});
