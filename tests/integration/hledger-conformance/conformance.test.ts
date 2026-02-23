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

    test('KNOWN DIVERGENCE: LSP infers costs for multi-commodity transactions', () => {
      // balanced.j has: a  1 A / b  -1 B (no explicit @ price)
      // hledger's "balanced" check rejects this, requiring explicit cost notation.
      // The LSP parser auto-infers a cost (like hledger's default "autobalanced"),
      // so the LSP considers this transaction balanced.
      //
      // This documents a known behavioral difference: the LSP does NOT implement
      // hledger's stricter "balanced" check mode. The LSP always auto-infers costs,
      // matching hledger's default autobalanced behavior.
      const filePath = path.join(errorsDir, 'balanced.j');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const result = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
          },
        },
      });

      // LSP auto-infers costs, so it considers this balanced (0 diagnostics)
      expect(result.diagnostics.length).toBe(0);

      // Verify the parser inferred a cost on the first posting
      const firstPosting = parsed.transactions[0]?.postings[0];
      expect(firstPosting?.cost?.inferred).toBe(true);
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

    // Files that pass hledger check but the LSP parser can't fully handle
    // (short dates, virtual postings, etc.)
    const hledgerOnlyFixtures = [
      'borrowing.journal', // Uses short dates (1/1, 2/1) — parser requires 4-digit years
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

    test.each(hledgerOnlyFixtures)('%s passes hledger check', (filename) => {
      const filePath = path.join(validDir, filename);
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);
    });

    test('KNOWN DIVERGENCE: unicode.journal virtual postings treated as unbalanced', () => {
      // unicode.journal uses virtual (parenthesized) postings like (ß).
      // hledger auto-balances virtual postings; the LSP does not.
      const filePath = path.join(validDir, 'unicode.journal');
      const hledgerResult = runHledgerCheck(filePath);
      expect(hledgerResult.success).toBe(true);

      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);
      expect(parsed.transactions.length).toBeGreaterThan(0);

      // The parser keeps parentheses in account names for virtual postings
      const accounts = [...parsed.accounts.keys()];
      expect(accounts.some(a => a.startsWith('('))).toBe(true);
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

    test('KNOWN DIVERGENCE: unicode.journal virtual posting account names include parens', () => {
      const filePath = path.join(validDir, 'unicode.journal');
      const { doc } = createDoc(filePath);
      const parsed = parser.parse(doc);

      const lspAccounts = [...parsed.accounts.keys()].sort();
      const hledgerAccounts = runHledgerAccounts(filePath).sort();

      // LSP includes parentheses: "(ß)" vs hledger's "ß"
      expect(lspAccounts).not.toEqual(hledgerAccounts);
      // But the underlying names match after stripping parens
      const stripped = lspAccounts.map(a => a.replace(/[()]/g, '')).sort();
      expect(stripped).toEqual(hledgerAccounts);
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
