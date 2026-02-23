/**
 * hledger CLI Conformance Tests
 *
 * Verifies that the LSP parser + validator produces the same diagnostic
 * outcomes as the `hledger` CLI for the same journal files.
 *
 * These tests:
 * 1. Run `hledger check` against real journal files (ground truth)
 * 2. Run the LSP parser + validator against the same files
 * 3. Assert both agree on what's valid and what's not
 *
 * Tests are skipped gracefully if hledger is not installed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../../src/parser';
import { Validator } from '../../../src/features/validator';
import { calculateRunningBalances } from '../../../src/utils/runningBalanceCalculator';
import { defaultSettings } from '../../../src/server/settings';
import {
  isHledgerAvailable,
  runHledgerCheck,
  runHledgerAccounts,
  runHledgerBalance,
  runHledgerAregister,
  runHledgerPrint,
} from './hledgerRunner';

const fixturesDir = path.join(__dirname, 'fixtures');
const errorsDir = path.join(fixturesDir, 'errors');
const validDir = path.join(fixturesDir, 'valid');

const hledgerInstalled = isHledgerAvailable();

const describeConformance = hledgerInstalled ? describe : describe.skip;

function createDoc(filePath: string): { doc: TextDocument; content: string } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const uri = URI.file(filePath).toString();
  const doc = TextDocument.create(uri, 'hledger', 1, content);
  return { doc, content };
}

describeConformance('hledger conformance', () => {
  let parser: HledgerParser;
  let validator: Validator;

  beforeEach(() => {
    parser = new HledgerParser();
    validator = new Validator();
  });

  // ─── Balance checks (autobalanced) ───────────────────────────────

  describe('balance checks (autobalanced)', () => {
    test('hledger and LSP agree: single-posting transaction is unbalanced', () => {
      const filePath = path.join(errorsDir, 'autobalanced.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(false);

      // LSP result — enable only balance + emptyTransactions (since 1 posting triggers both)
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            emptyTransactions: true,
          },
        },
      });

      // LSP should also find errors
      expect(result.diagnostics.length).toBeGreaterThan(0);

      // Verify error is on the right line (hledger reports line 3 for the date line)
      const hledgerLine = hledgerResult.errors[0]?.line;
      if (hledgerLine) {
        const matchingDiag = result.diagnostics.find(
          d => d.range.start.line === hledgerLine - 1 // hledger is 1-based, LSP is 0-based
        );
        expect(matchingDiag).toBeDefined();
      }
    });
  });

  // ─── Balance checks (balanced — multi-commodity) ─────────────────

  describe('balance checks (balanced — multi-commodity)', () => {
    test('hledger rejects implicit commodity conversion with "balanced" check', () => {
      const filePath = path.join(errorsDir, 'balanced.j');

      // Ground truth: hledger's "balanced" check rejects multi-commodity
      // transactions without explicit @ cost notation
      const hledgerResult = runHledgerCheck(filePath, ['balanced']);
      expect(hledgerResult.success).toBe(false);
    });

    test.failing('LSP should reject implicit commodity conversion when strict balance is enabled', () => {
      // balanced.j has: a  1 A / b  -1 B (no explicit @ price)
      // hledger's "balanced" check rejects this, requiring explicit cost notation.
      // The LSP currently always auto-infers costs (matching hledger's "autobalanced").
      //
      // To fix: add a validation setting (e.g., "requireExplicitCosts") that,
      // when enabled, rejects multi-commodity transactions without explicit @ cost
      // notation — mirroring hledger's stricter "balanced" check.
      const filePath = path.join(errorsDir, 'balanced.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            // When we add this setting, enable it here:
            // requireExplicitCosts: true,
          },
        },
      });

      // LSP should reject the implicit commodity conversion
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const balanceDiag = result.diagnostics.find(d =>
        d.message.toLowerCase().includes('cost') ||
        d.message.toLowerCase().includes('balance') ||
        d.message.toLowerCase().includes('commodity')
      );
      expect(balanceDiag).toBeDefined();
    });
  });

  // ─── Balance assertions ──────────────────────────────────────────

  describe('balance assertions', () => {
    test('hledger and LSP agree: failed balance assertion', () => {
      const filePath = path.join(errorsDir, 'assertions.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(false);

      // LSP result
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balanceAssertions: true,
          },
        },
      });

      // LSP should detect the failed assertion
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const assertionDiag = result.diagnostics.find(d =>
        d.message.toLowerCase().includes('balance assertion')
      );
      expect(assertionDiag).toBeDefined();

      // Verify error is on the right line
      const hledgerLine = hledgerResult.errors[0]?.line;
      if (hledgerLine && assertionDiag) {
        // hledger reports line 4 (1-based), LSP should report line 3 (0-based)
        expect(assertionDiag.range.start.line).toBe(hledgerLine - 1);
      }
    });
  });

  // ─── Undeclared accounts (--strict / check accounts) ─────────────

  describe('undeclared accounts', () => {
    test('hledger and LSP agree: undeclared account is an error', () => {
      const filePath = path.join(errorsDir, 'accounts.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath, ['accounts']);
      expect(hledgerResult.success).toBe(false);

      // LSP result
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            undeclaredAccounts: true,
          },
        },
      });

      // LSP should detect the undeclared account
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const accountDiag = result.diagnostics.find(d =>
        d.message.toLowerCase().includes('undeclared account') ||
        d.message.toLowerCase().includes('not declared')
      );
      expect(accountDiag).toBeDefined();

      // Verify error is on the right line
      const hledgerLine = hledgerResult.errors[0]?.line;
      if (hledgerLine && accountDiag) {
        expect(accountDiag.range.start.line).toBe(hledgerLine - 1);
      }
    });
  });

  // ─── Undeclared commodities ──────────────────────────────────────

  describe('undeclared commodities', () => {
    test('hledger and LSP agree: undeclared commodity is an error', () => {
      const filePath = path.join(errorsDir, 'commodities.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath, ['commodities']);
      expect(hledgerResult.success).toBe(false);

      // LSP result
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            undeclaredCommodities: true,
          },
        },
      });

      // LSP should detect the undeclared commodity
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const commodityDiag = result.diagnostics.find(d =>
        d.message.toLowerCase().includes('undeclared commodity') ||
        d.message.toLowerCase().includes('not declared')
      );
      expect(commodityDiag).toBeDefined();

      // Verify error is on the right line
      const hledgerLine = hledgerResult.errors[0]?.line;
      if (hledgerLine && commodityDiag) {
        expect(commodityDiag.range.start.line).toBe(hledgerLine - 1);
      }
    });
  });

  // ─── Undeclared payees ───────────────────────────────────────────

  describe('undeclared payees', () => {
    test('hledger and LSP agree: undeclared payee is an error', () => {
      const filePath = path.join(errorsDir, 'payees.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath, ['payees']);
      expect(hledgerResult.success).toBe(false);

      // LSP result
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            undeclaredPayees: true,
          },
        },
      });

      // LSP should detect the undeclared payee
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const payeeDiag = result.diagnostics.find(d =>
        d.message.toLowerCase().includes('undeclared payee') ||
        d.message.toLowerCase().includes('not declared')
      );
      expect(payeeDiag).toBeDefined();

      // Verify error is on the right line
      const hledgerLine = hledgerResult.errors[0]?.line;
      if (hledgerLine && payeeDiag) {
        expect(payeeDiag.range.start.line).toBe(hledgerLine - 1);
      }
    });
  });

  // ─── Date ordering ──────────────────────────────────────────────

  describe('date ordering', () => {
    test('hledger and LSP agree: out-of-order dates are an error', () => {
      const filePath = path.join(errorsDir, 'ordereddates.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath, ['ordereddates']);
      expect(hledgerResult.success).toBe(false);

      // LSP result
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            dateOrdering: true,
          },
        },
      });

      // LSP should detect the date ordering issue
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const dateOrderDiag = result.diagnostics.find(d =>
        d.message.toLowerCase().includes('before previous') ||
        d.message.toLowerCase().includes('out of order')
      );
      expect(dateOrderDiag).toBeDefined();

      // Verify error is on the right line (hledger reports line 10, the out-of-order transaction)
      const hledgerLine = hledgerResult.errors[0]?.line;
      if (hledgerLine && dateOrderDiag) {
        expect(dateOrderDiag.range.start.line).toBe(hledgerLine - 1);
      }
    });
  });

  // ─── Parse errors (invalid content) ─────────────────────────────

  describe('parse errors', () => {
    test('hledger and LSP agree: unparseable content is invalid', () => {
      const filePath = path.join(errorsDir, 'parseable.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(false);

      // The LSP parser should either produce no valid transactions from this garbage,
      // or produce diagnostics. The key assertion: both agree it's invalid.
      // For a file containing just "1", the parser won't produce valid transactions.
      // The validator with all checks might flag emptiness or the LSP simply produces
      // no meaningful parse result.
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            emptyTransactions: true,
            invalidDates: true,
          },
        },
      });

      // The LSP may handle pure parse errors differently than hledger.
      // We verify at minimum that the parser doesn't produce a valid transaction
      // from the garbage input "1".
      expect(parsed.transactions.length).toBe(0);
    });

    test('hledger and LSP agree: invalid date is an error', () => {
      const filePath = path.join(errorsDir, 'parseable-dates.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(false);

      // LSP result — check for invalid dates
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            invalidDates: true,
          },
        },
      });

      // The LSP should either reject the invalid date (2022/1/32) at the parser level
      // or produce a diagnostic. Since the parser may or may not parse "day 32",
      // we check that at least one of: no transactions parsed, or a diagnostic is raised.
      const hasError = result.diagnostics.length > 0 || parsed.transactions.length === 0;
      expect(hasError).toBe(true);
    });
  });

  // ─── Valid journals (no false positives) ─────────────────────────

  describe('valid journals (no false positives)', () => {
    test('hledger and LSP agree: sample.journal is valid', () => {
      const filePath = path.join(validDir, 'sample.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      // LSP result — enable the same checks hledger runs by default
      // (parseable, autobalanced, assertions)
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            balanceAssertions: true,
            invalidDates: true,
            missingAmounts: true,
          },
        },
      });

      // LSP should produce no errors for default hledger checks
      const errors = result.diagnostics.filter(
        d => d.severity === 1 // DiagnosticSeverity.Error
      );
      expect(errors).toEqual([]);
    });

    test('hledger and LSP agree: multicurrency.journal is valid', () => {
      const filePath = path.join(validDir, 'multicurrency.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      // LSP result — enable only the checks hledger runs by default:
      // parseable, autobalanced, assertions.
      // NOTE: missingAmounts is NOT a default hledger check — hledger handles
      // postings with balance assertions (==*) and no explicit amount via
      // auto-balancing, which the LSP's missingAmounts check doesn't account for.
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            balanceAssertions: true,
            invalidDates: true,
          },
        },
      });

      // LSP should produce no errors for default hledger checks
      const errors = result.diagnostics.filter(
        d => d.severity === 1 // DiagnosticSeverity.Error
      );
      expect(errors).toEqual([]);
    });
  });

  // ─── Cross-check: valid files pass strict checks too ─────────────

  describe('valid journals pass strict checks with declarations', () => {
    test('ordereddates fixture has correctly ordered dates before the error', () => {
      // The ordereddates.j file has dates 2022/1/2 then 2022/1/1
      // Verify hledger and LSP agree on which transaction is out of order
      const filePath = path.join(errorsDir, 'ordereddates.j');
      const hledgerResult = runHledgerCheck(filePath, ['ordereddates']);

      expect(hledgerResult.success).toBe(false);
      // hledger should report line 10 (the 2022/1/1 transaction)
      expect(hledgerResult.errors[0]?.line).toBe(10);
    });
  });

  // ─── Expanded fixture validation ──────────────────────────────────

  describe('valid journals — expanded fixtures', () => {
    // Files where the LSP parser can parse AND validate (4-digit year dates, no virtual postings)
    const parseableFixtures = [
      'quickstart.journal',
      'Cody.journal',
      'sample2.journal',
      'chinese.journal',
      'ascii.journal',
      'costs-implicit.j',
      'costs-unit.j',
      'costs-total.j',
      'vat.journal',
    ];

    test.each(parseableFixtures)('%s passes both hledger and LSP', (filename) => {
      const filePath = path.join(validDir, filename);
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      // LSP should parse transactions
      expect(parsed.transactions.length).toBeGreaterThan(0);

      // LSP validation — default hledger checks
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            balanceAssertions: true,
            invalidDates: true,
          },
        },
      });

      const errors = result.diagnostics.filter(d => d.severity === 1);
      expect(errors).toEqual([]);
    });

    // ── Parser gaps: these test.failing() tests document real divergences ──
    // They pass in CI today (Jest inverts the assertion) and will start
    // failing once the underlying issue is fixed, prompting us to flip
    // them to normal tests.

    test.failing('borrowing.journal: parser should handle short (yearless) dates', () => {
      // borrowing.journal uses dates like "1/1", "2/1" without a 4-digit year.
      // hledger accepts these (defaults to current year). The LSP parser
      // requires 4-digit years, so it produces 0 transactions.
      const filePath = path.join(validDir, 'borrowing.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      // This is what we WANT to pass — parser should find transactions
      expect(parsed.transactions.length).toBeGreaterThan(0);

      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            balanceAssertions: true,
            invalidDates: true,
          },
        },
      });

      const errors = result.diagnostics.filter(d => d.severity === 1);
      expect(errors).toEqual([]);
    });

    test.failing('unicode.journal: parser should handle virtual postings', () => {
      // unicode.journal uses virtual (parenthesized) postings like (ß).
      // hledger auto-balances virtual postings; the LSP parser should
      // strip parens from account names and not report balance errors.
      const filePath = path.join(validDir, 'unicode.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      // Ground truth
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      expect(parsed.transactions.length).toBeGreaterThan(0);

      // Account names should NOT include parentheses
      const accounts = [...parsed.accounts.keys()];
      expect(accounts.every(a => !a.startsWith('('))).toBe(true);

      // Validation should produce no errors (virtual postings auto-balance)
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
          },
        },
      });

      const errors = result.diagnostics.filter(d => d.severity === 1);
      expect(errors).toEqual([]);
    });
  });

  // ─── Account discovery ────────────────────────────────────────────

  describe('account discovery', () => {
    // Files where parser account names match hledger exactly
    const accountMatchFixtures = [
      'sample.journal',
      'quickstart.journal',
      'Cody.journal',
      'sample2.journal',
      'chinese.journal',
      'ascii.journal',
      'costs-implicit.j',
      'costs-unit.j',
      'costs-total.j',
      'vat.journal',
    ];

    test.each(accountMatchFixtures)(
      '%s: LSP and hledger find the same accounts',
      (filename) => {
        const filePath = path.join(validDir, filename);
        const { doc } = createDoc(filePath);
        const parsed = parser.parse(doc);

        const lspAccounts = [...parsed.accounts.keys()].sort();
        const hledgerAccounts = runHledgerAccounts(filePath).sort();

        expect(lspAccounts).toEqual(hledgerAccounts);
      }
    );

    test.failing('unicode.journal: virtual posting account names should not include parens', () => {
      // The parser keeps parentheses in account names: "(ß)" instead of "ß".
      // hledger strips parens — they denote virtual postings, not part of the name.
      const filePath = path.join(validDir, 'unicode.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const lspAccounts = [...parsed.accounts.keys()].sort();
      const hledgerAccounts = runHledgerAccounts(filePath).sort();

      expect(lspAccounts).toEqual(hledgerAccounts);
    });

    test.failing('borrowing.journal: parser should discover accounts from short-date files', () => {
      // Parser requires 4-digit years, so it finds 0 accounts.
      // hledger finds all accounts from short-date entries.
      const filePath = path.join(validDir, 'borrowing.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const lspAccounts = [...parsed.accounts.keys()].sort();
      const hledgerAccounts = runHledgerAccounts(filePath).sort();

      expect(lspAccounts).toEqual(hledgerAccounts);
    });
  });

  // ─── Final account balances ───────────────────────────────────────

  describe('final account balances', () => {
    const balanceFixtures = [
      'sample.journal',
      'quickstart.journal',
      'vat.journal',
    ];

    test.each(balanceFixtures)(
      '%s: LSP final balances match hledger balance',
      (filename) => {
        const filePath = path.join(validDir, filename);
        const { doc } = createDoc(filePath);
        const parsed = parser.parse(doc);
        const runningBalances = calculateRunningBalances(parsed);

        // Extract final balance per account from LSP
        const lspFinalBalances = new Map<string, Map<string, number>>();
        parsed.transactions.forEach((tx, txIdx) => {
          tx.postings.forEach((p, pIdx) => {
            const postingBalances = runningBalances.get(txIdx)?.get(pIdx);
            if (postingBalances) {
              for (const [commodity, balance] of postingBalances) {
                if (!lspFinalBalances.has(p.account)) {
                  lspFinalBalances.set(p.account, new Map());
                }
                lspFinalBalances.get(p.account)!.set(commodity, balance);
              }
            }
          });
        });

        // Get hledger ground truth
        const hledgerEntries = runHledgerBalance(filePath);

        // Verify every non-zero hledger balance matches LSP
        for (const entry of hledgerEntries) {
          const lspAmounts = lspFinalBalances.get(entry.account);
          expect(lspAmounts).toBeDefined();
          if (!lspAmounts) continue;

          for (const [commodity, hledgerQty] of entry.amounts) {
            const lspQty = lspAmounts.get(commodity) ?? 0;
            expect(Math.abs(lspQty - hledgerQty)).toBeLessThan(0.005);
          }
        }

        // Verify LSP doesn't have large balances for accounts hledger omits
        const hledgerAccountSet = new Set(hledgerEntries.map(e => e.account));
        for (const [account, commodities] of lspFinalBalances) {
          if (!hledgerAccountSet.has(account)) {
            // hledger omits zero-balance accounts — LSP should also be near zero
            for (const [, balance] of commodities) {
              expect(Math.abs(balance)).toBeLessThan(0.005);
            }
          }
        }
      }
    );

    test.failing('borrowing.journal: LSP final balances should match hledger', () => {
      // Parser can't handle short dates (1/1, 2/1), so it finds 0 transactions
      // and therefore 0 balances. Once short dates are supported this should pass.
      const filePath = path.join(validDir, 'borrowing.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);
      const runningBalances = calculateRunningBalances(parsed);

      const lspFinalBalances = new Map<string, Map<string, number>>();
      parsed.transactions.forEach((tx, txIdx) => {
        tx.postings.forEach((p, pIdx) => {
          const postingBalances = runningBalances.get(txIdx)?.get(pIdx);
          if (postingBalances) {
            for (const [commodity, balance] of postingBalances) {
              if (!lspFinalBalances.has(p.account)) {
                lspFinalBalances.set(p.account, new Map());
              }
              lspFinalBalances.get(p.account)!.set(commodity, balance);
            }
          }
        });
      });

      const hledgerEntries = runHledgerBalance(filePath);

      for (const entry of hledgerEntries) {
        const lspAmounts = lspFinalBalances.get(entry.account);
        expect(lspAmounts).toBeDefined();
        if (!lspAmounts) continue;

        for (const [commodity, hledgerQty] of entry.amounts) {
          const lspQty = lspAmounts.get(commodity) ?? 0;
          expect(Math.abs(lspQty - hledgerQty)).toBeLessThan(0.005);
        }
      }
    });
  });

  // ─── Running balances (aregister) ─────────────────────────────────

  describe('running balances (aregister)', () => {
    test('sample.journal: assets:bank:checking running balance matches hledger', () => {
      const filePath = path.join(validDir, 'sample.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);
      const runningBalances = calculateRunningBalances(parsed);

      const hledgerEntries = runHledgerAregister(filePath, 'assets:bank:checking');

      // Collect LSP running balances for this account in transaction order
      const lspEntries: { txIdx: number; balance: Map<string, number> }[] = [];
      parsed.transactions.forEach((tx, txIdx) => {
        tx.postings.forEach((p, pIdx) => {
          if (p.account === 'assets:bank:checking') {
            const balances = runningBalances.get(txIdx)?.get(pIdx);
            if (balances) {
              lspEntries.push({ txIdx, balance: balances });
            }
          }
        });
      });

      expect(lspEntries.length).toBe(hledgerEntries.length);

      for (let i = 0; i < hledgerEntries.length; i++) {
        const hEntry = hledgerEntries[i];
        const lEntry = lspEntries[i];

        // txnidx is 1-based in hledger, 0-based in LSP
        expect(lEntry.txIdx).toBe(hEntry.txnidx - 1);

        // Compare balances per commodity
        for (const [commodity, hledgerBal] of hEntry.balance) {
          const lspBal = lEntry.balance.get(commodity) ?? 0;
          expect(Math.abs(lspBal - hledgerBal)).toBeLessThan(0.005);
        }
      }
    });

    test('quickstart.journal: assets:bank:checking running balance matches hledger', () => {
      const filePath = path.join(validDir, 'quickstart.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);
      const runningBalances = calculateRunningBalances(parsed);

      const hledgerEntries = runHledgerAregister(filePath, 'assets:bank:checking');

      const lspEntries: { txIdx: number; balance: Map<string, number> }[] = [];
      parsed.transactions.forEach((tx, txIdx) => {
        tx.postings.forEach((p, pIdx) => {
          if (p.account === 'assets:bank:checking') {
            const balances = runningBalances.get(txIdx)?.get(pIdx);
            if (balances) {
              lspEntries.push({ txIdx, balance: balances });
            }
          }
        });
      });

      expect(lspEntries.length).toBe(hledgerEntries.length);

      for (let i = 0; i < hledgerEntries.length; i++) {
        for (const [commodity, hledgerBal] of hledgerEntries[i].balance) {
          const lspBal = lspEntries[i].balance.get(commodity) ?? 0;
          expect(Math.abs(lspBal - hledgerBal)).toBeLessThan(0.005);
        }
      }
    });

    test.failing('borrowing.journal: assets:cash running balance should match hledger', () => {
      // Parser can't handle short dates, so it finds 0 transactions.
      const filePath = path.join(validDir, 'borrowing.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);
      const runningBalances = calculateRunningBalances(parsed);

      const hledgerEntries = runHledgerAregister(filePath, 'assets:cash');

      const lspEntries: { txIdx: number; balance: Map<string, number> }[] = [];
      parsed.transactions.forEach((tx, txIdx) => {
        tx.postings.forEach((p, pIdx) => {
          if (p.account === 'assets:cash') {
            const balances = runningBalances.get(txIdx)?.get(pIdx);
            if (balances) {
              lspEntries.push({ txIdx, balance: balances });
            }
          }
        });
      });

      expect(lspEntries.length).toBe(hledgerEntries.length);
    });
  });

  // ─── Inferred amounts ────────────────────────────────────────────

  describe('inferred amounts', () => {
    test('sample.journal: LSP infers same amounts as hledger', () => {
      const filePath = path.join(validDir, 'sample.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const hledgerTxns = runHledgerPrint(filePath);

      expect(parsed.transactions.length).toBe(hledgerTxns.length);

      for (let txIdx = 0; txIdx < parsed.transactions.length; txIdx++) {
        const lspTx = parsed.transactions[txIdx];
        const hTx = hledgerTxns[txIdx];

        expect(lspTx.postings.length).toBe(hTx.postings.length);

        for (let pIdx = 0; pIdx < lspTx.postings.length; pIdx++) {
          const lspPosting = lspTx.postings[pIdx];
          const hPosting = hTx.postings[pIdx];

          // Every posting should have an amount (explicit or inferred)
          expect(lspPosting.amount).toBeDefined();
          if (!lspPosting.amount) continue;

          // Compare quantity and commodity
          const hAmount = hPosting.amounts[0];
          expect(hAmount).toBeDefined();
          if (!hAmount) continue;

          expect(lspPosting.amount.commodity).toBe(hAmount.commodity);
          expect(Math.abs(lspPosting.amount.quantity - hAmount.quantity)).toBeLessThan(0.005);
        }
      }
    });

    test('quickstart.journal: LSP infers same amounts as hledger', () => {
      const filePath = path.join(validDir, 'quickstart.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const hledgerTxns = runHledgerPrint(filePath);

      expect(parsed.transactions.length).toBe(hledgerTxns.length);

      for (let txIdx = 0; txIdx < parsed.transactions.length; txIdx++) {
        const lspTx = parsed.transactions[txIdx];
        const hTx = hledgerTxns[txIdx];

        expect(lspTx.postings.length).toBe(hTx.postings.length);

        for (let pIdx = 0; pIdx < lspTx.postings.length; pIdx++) {
          const lspPosting = lspTx.postings[pIdx];
          const hPosting = hTx.postings[pIdx];

          expect(lspPosting.amount).toBeDefined();
          if (!lspPosting.amount) continue;

          const hAmount = hPosting.amounts[0];
          expect(hAmount).toBeDefined();
          if (!hAmount) continue;

          expect(lspPosting.amount.commodity).toBe(hAmount.commodity);
          expect(Math.abs(lspPosting.amount.quantity - hAmount.quantity)).toBeLessThan(0.005);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Parser divergences — test.failing() tests for known gaps
  //
  // These tests assert what the CORRECT behavior should be. They pass
  // in CI because Jest's test.failing() inverts the result. When a gap
  // is fixed, the test will start "failing" (i.e., passing internally),
  // prompting us to flip it to a normal test().
  // ═══════════════════════════════════════════════════════════════════

  // ─── comment/end comment block directive ──────────────────────────

  describe('comment block directive', () => {
    test.failing('parser should ignore content inside comment/end comment blocks', () => {
      // hledger's `comment` directive starts a multi-line comment block;
      // `end comment` ends it. Everything between is ignored.
      // The LSP parser does not implement this — it parses content inside
      // the block as real transactions and directives.
      const filePath = path.join(validDir, 'comment-block.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      // hledger sees 2 transactions (the one inside `comment` block is ignored)
      const hledgerAccounts = runHledgerAccounts(filePath);
      expect(hledgerAccounts).not.toContain('income:bonus');

      // LSP should also see only 2 transactions
      expect(parsed.transactions.length).toBe(2);
      expect([...parsed.accounts.keys()]).not.toContain('income:bonus');
    });
  });

  // ─── Dot-separated dates ──────────────────────────────────────────

  describe('dot-separated dates', () => {
    test.failing('parser should handle dot-separated dates (2024.01.01)', () => {
      // hledger accepts `.` as a date separator alongside `-` and `/`.
      // The LSP parser only recognizes `-` and `/`.
      const filePath = path.join(validDir, 'dot-dates.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      // hledger finds 2 transactions
      const hledgerAccounts = runHledgerAccounts(filePath);
      expect(hledgerAccounts.length).toBeGreaterThan(0);

      // LSP should also find transactions
      expect(parsed.transactions.length).toBe(2);
    });
  });

  // ─── Virtual postings ────────────────────────────────────────────

  describe('virtual postings', () => {
    test.failing('parser should strip parens/brackets and recognize virtual postings', () => {
      // hledger supports two types of virtual postings:
      //   (account)  — unbalanced virtual (auto-balances)
      //   [account]  — balanced virtual (must balance with other balanced virtuals)
      // The LSP parser keeps the delimiters in the account name and doesn't
      // recognize the virtual posting semantics.
      const filePath = path.join(validDir, 'virtual-postings.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      const hledgerAccounts = runHledgerAccounts(filePath).sort();
      const lspAccounts = [...parsed.accounts.keys()].sort();

      // Account names should NOT include parentheses or brackets
      expect(lspAccounts.every(a => !a.startsWith('(') && !a.startsWith('['))).toBe(true);

      // Should match hledger's account list
      expect(lspAccounts).toEqual(hledgerAccounts);

      // Validation: no balance errors (virtual postings auto-balance)
      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
          },
        },
      });
      const errors = result.diagnostics.filter(d => d.severity === 1);
      expect(errors).toEqual([]);
    });
  });

  // ─── Posting-level status markers ────────────────────────────────

  describe('posting-level status markers', () => {
    test.failing('parser should strip */! status from posting account names', () => {
      // hledger supports per-posting status markers:
      //   * account  $100  — cleared posting
      //   ! account  $50   — pending posting
      // The LSP parser includes the marker as part of the account name.
      const filePath = path.join(validDir, 'posting-status.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      const hledgerAccounts = runHledgerAccounts(filePath).sort();
      const lspAccounts = [...parsed.accounts.keys()].sort();

      // Account names should NOT start with * or !
      expect(lspAccounts.every(a => !a.startsWith('*') && !a.startsWith('!'))).toBe(true);

      // Should match hledger's account list
      expect(lspAccounts).toEqual(hledgerAccounts);
    });
  });

  // ─── Thousands separator parsing ─────────────────────────────────

  describe('thousands separator parsing', () => {
    test.failing('parser should correctly parse amounts with thousands separators', () => {
      // With a commodity directive establishing comma as thousands separator,
      // amounts like $18,000,000 and $1,500 should be parsed correctly.
      // The LSP parser mishandles these:
      //   $18,000,000 → 18 (only first segment)
      //   $1,000 → 1 (treated as decimal)
      const filePath = path.join(validDir, 'thousands.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      // Find the lottery transaction
      const lotteryPosting = parsed.transactions
        .flatMap(t => t.postings)
        .find(p => p.account === 'assets:savings');
      expect(lotteryPosting?.amount).toBeDefined();
      expect(lotteryPosting!.amount!.quantity).toBe(18000000);

      // Find the rent posting
      const rentPosting = parsed.transactions
        .flatMap(t => t.postings)
        .find(p => p.account === 'expenses:rent');
      expect(rentPosting?.amount).toBeDefined();
      expect(rentPosting!.amount!.quantity).toBe(1500);

      // Find the car posting
      const carPosting = parsed.transactions
        .flatMap(t => t.postings)
        .find(p => p.account === 'expenses:car');
      expect(carPosting?.amount).toBeDefined();
      expect(carPosting!.amount!.quantity).toBe(1000);
    });

    test.failing('Cody.journal: $18,000,000 should be parsed as 18 million', () => {
      // Cody.journal has a lottery win of $18,000,000 which the parser
      // currently reads as $18. This causes the final balance of
      // Assets:Savings to be $153,654 instead of $18,146,836.
      const filePath = path.join(validDir, 'Cody.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);
      const runningBalances = calculateRunningBalances(parsed);

      // Extract final balance for Assets:Savings
      let lspSavings = 0;
      parsed.transactions.forEach((tx, txIdx) => {
        tx.postings.forEach((p, pIdx) => {
          if (p.account === 'Assets:Savings') {
            const b = runningBalances.get(txIdx)?.get(pIdx);
            if (b) lspSavings = b.get('$') ?? 0;
          }
        });
      });

      // hledger reports $18,146,836
      const hledgerEntries = runHledgerBalance(filePath);
      const hledgerSavings = hledgerEntries.find(e => e.account === 'Assets:Savings');
      expect(hledgerSavings).toBeDefined();
      const hledgerAmount = hledgerSavings!.amounts.get('$') ?? 0;

      expect(Math.abs(lspSavings - hledgerAmount)).toBeLessThan(0.005);
    });
  });
});

/**
 * Returns a ValidationOptions object with all checks disabled.
 * Tests selectively enable only the checks they need.
 */
function disableAll(): typeof defaultSettings.validation {
  return {
    balance: false,
    missingAmounts: false,
    undeclaredAccounts: false,
    undeclaredPayees: false,
    undeclaredCommodities: false,
    undeclaredTags: false,
    dateOrdering: false,
    balanceAssertions: false,
    emptyTransactions: false,
    invalidDates: false,
    futureDates: false,
    emptyDescriptions: false,
    formatMismatch: false,
    includeFiles: false,
    circularIncludes: false,
    markAllUndeclaredInstances: true,
  };
}
