/**
 * Performance benchmarks for large synthetic journals.
 *
 * These tests generate large journals, time the parser and key features,
 * and assert times stay within generous budgets as a regression guard.
 * Budgets are deliberately loose — the goal is catching O(n²) regressions,
 * not enforcing tight SLAs.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { HledgerParser } from '../../src/parser';
import { semanticTokensProvider } from '../../src/features/semanticTokens';
import { Validator } from '../../src/features/validator';
import { CompletionProvider } from '../../src/features/completion';
import { findReferencesProvider } from '../../src/features/findReferences';
import { ParsedDocument } from '../../src/types';
import { createTestWorkspace } from '../helpers/workspaceTestHelper';
import {
  generateJournal,
  generateWorkspaceFiles,
  buildAccountPool,
  buildCommodityPool,
  buildPayeePool,
} from './generators';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(content: string, uri = 'file:///perf-test.journal'): TextDocument {
  return TextDocument.create(uri, 'hledger', 1, content);
}

function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function assertWithinBudget(elapsed: number, budgetMs: number, label: string) {
  console.log(`  [perf] ${label}: ${elapsed.toFixed(1)} ms (budget ${budgetMs} ms)`);
  expect(elapsed).toBeLessThan(budgetMs);
}

// ---------------------------------------------------------------------------
// Large file parsing
// ---------------------------------------------------------------------------

describe('Performance: Large file parsing', () => {
  let content500: string;
  let content2000: string;

  beforeAll(() => {
    content500 = generateJournal(500);
    content2000 = generateJournal(2000);
  });

  test('parses 500 transactions within budget', () => {
    const parser = new HledgerParser();
    const doc = makeDoc(content500);

    let parsed!: ParsedDocument;
    const elapsed = timeMs(() => {
      parsed = parser.parse(doc);
    });

    expect(parsed.transactions.length).toBe(500);
    assertWithinBudget(elapsed, 2000, 'parse 500 txns');
  });

  test('parses 2000 transactions within budget', () => {
    const parser = new HledgerParser();
    const doc = makeDoc(content2000);

    let parsed!: ParsedDocument;
    const elapsed = timeMs(() => {
      parsed = parser.parse(doc);
    });

    expect(parsed.transactions.length).toBe(2000);
    assertWithinBudget(elapsed, 5000, 'parse 2000 txns');
  });

  test('semantic tokens for 2000 txns within budget', () => {
    const doc = makeDoc(content2000);

    let tokens!: number[];
    const elapsed = timeMs(() => {
      tokens = semanticTokensProvider.provideSemanticTokens(doc);
    });

    expect(tokens.length).toBeGreaterThan(0);
    assertWithinBudget(elapsed, 3000, 'semantic tokens 2000 txns');
  });

  test('validation for 2000 txns within budget', () => {
    const parser = new HledgerParser();
    const doc = makeDoc(content2000);
    const parsed = parser.parse(doc);

    const validator = new Validator();
    const elapsed = timeMs(() => {
      validator.validate(doc, parsed);
    });

    assertWithinBudget(elapsed, 3000, 'validation 2000 txns');
  });
});

// ---------------------------------------------------------------------------
// Wide workspace
// ---------------------------------------------------------------------------

describe('Performance: Wide workspace', () => {
  test('50-file workspace init + parse within budget', async () => {
    const files = generateWorkspaceFiles(50, 20);

    const start = performance.now();
    const workspace = await createTestWorkspace({ files });
    const parsed = workspace.parseWorkspace();
    const elapsed = performance.now() - start;

    expect(parsed).not.toBeNull();
    // 50 files × 20 txns = 1000 total transactions
    expect(parsed!.transactions.length).toBe(1000);
    assertWithinBudget(elapsed, 5000, '50-file workspace init+parse');
  });
});

// ---------------------------------------------------------------------------
// Many entities (completion + find references)
// ---------------------------------------------------------------------------

describe('Performance: Many entities', () => {
  const ACCOUNT_COUNT = 500;
  const COMMODITY_COUNT = 50;
  const PAYEE_COUNT = 100;

  let content: string;
  let doc: TextDocument;
  let parsed: ParsedDocument;

  beforeAll(() => {
    content = generateJournal(200, {
      accountCount: ACCOUNT_COUNT,
      commodityCount: COMMODITY_COUNT,
      payeeCount: PAYEE_COUNT,
    });
    const parser = new HledgerParser();
    doc = makeDoc(content);
    parsed = parser.parse(doc);
  });

  test('completion with 500 accounts within budget', () => {
    const provider = new CompletionProvider();
    provider.updateAccounts(parsed.accounts);
    provider.updatePayees(parsed.payees);
    provider.updateCommodities(parsed.commodities);
    provider.updateTags(parsed.tags);

    // Position on an empty posting line (trigger account completion)
    // Find a line that starts with spaces (a posting line)
    const lines = content.split('\n');
    let postingLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('    ') && lines[i].trim().length > 0) {
        postingLine = i;
        break;
      }
    }
    const position: Position = { line: postingLine, character: 4 };

    let items!: ReturnType<CompletionProvider['getCompletionItems']>;
    const elapsed = timeMs(() => {
      items = provider.getCompletionItems(doc, position, parsed);
    });

    expect(items.length).toBeGreaterThan(0);
    assertWithinBudget(elapsed, 1000, 'completion 500 accounts');
  });

  test('find references with 500 accounts within budget', () => {
    // Find the line of an account declaration so we have a known position
    const lines = content.split('\n');
    let acctLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('account ')) {
        acctLine = i;
        break;
      }
    }
    const position: Position = { line: acctLine, character: 10 };

    let refs!: ReturnType<typeof findReferencesProvider.findReferences>;
    const elapsed = timeMs(() => {
      refs = findReferencesProvider.findReferences(doc, position, parsed);
    });

    // May or may not find references depending on which account, but should not crash
    assertWithinBudget(elapsed, 2000, 'find references 500 accounts');
  });
});
