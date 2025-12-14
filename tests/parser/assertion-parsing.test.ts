/**
 * Tests for parsing balance assertions with various spacing
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { HledgerParser } from '../../src/parser';

describe('Parser - Balance Assertion Spacing', () => {
  let parser: HledgerParser;

  beforeEach(() => {
    parser = new HledgerParser();
  });

  test('should parse assertion with standard spacing', () => {
    const content = `2025-01-01 Test
    assets:checking    $100 = $100
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].postings).toHaveLength(1);
    expect(parsed.transactions[0].postings[0].assertion).toBeDefined();
    expect(parsed.transactions[0].postings[0].assertion!.quantity).toBe(100);
  });

  test('should parse assertion with extra spacing before amount', () => {
    const content = `2025-01-01 Test
    assets:checking    200 =   600.00
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].postings).toHaveLength(1);
    expect(parsed.transactions[0].postings[0].assertion).toBeDefined();
    expect(parsed.transactions[0].postings[0].assertion!.quantity).toBe(600);
  });

  test('should parse assertion with space before negative sign', () => {
    const content = `2025-01-01 Test
    equity:ob    -200.00 = - 600.00
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    console.log('Parsed transaction:', JSON.stringify(parsed.transactions[0], null, 2));

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].postings).toHaveLength(1);
    expect(parsed.transactions[0].postings[0].assertion).toBeDefined();
    expect(parsed.transactions[0].postings[0].assertion!.quantity).toBe(-600);
  });

  test('should parse assertion on posting without amount', () => {
    const content = `2025-01-01 Test
    expenses:test     = - 600.00
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    console.log('Parsed transaction:', JSON.stringify(parsed.transactions[0], null, 2));

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].postings).toHaveLength(1);
    expect(parsed.transactions[0].postings[0].assertion).toBeDefined();
    expect(parsed.transactions[0].postings[0].assertion!.quantity).toBe(-600);
  });

  test('should parse formatter output with aligned assertions', () => {
    const content = `2025-01-01 Opening
    assets:cash                                  200    =   600.00
    equity:ob                                   -200.00 = - 600.00
    expenses:test                                        = - 600.00
`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);

    console.log('Parsed transactions:', JSON.stringify(parsed.transactions, null, 2));

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].postings).toHaveLength(3);

    // All three postings should have assertions
    expect(parsed.transactions[0].postings[0].assertion).toBeDefined();
    expect(parsed.transactions[0].postings[1].assertion).toBeDefined();
    expect(parsed.transactions[0].postings[2].assertion).toBeDefined();

    expect(parsed.transactions[0].postings[0].assertion!.quantity).toBe(600);
    expect(parsed.transactions[0].postings[1].assertion!.quantity).toBe(-600);
    expect(parsed.transactions[0].postings[2].assertion!.quantity).toBe(-600);
  });
});
