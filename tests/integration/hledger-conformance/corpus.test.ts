/**
 * Differential test over the vendored hledger test corpus.
 *
 * For every journal in corpus/ (extracted from hledger's own test suite by
 * scripts/vendor-hledger-corpus.mjs), runs `hledger check` as ground truth
 * and the LSP parser+validator with the equivalent checks, then compares
 * verdicts. Writes a detailed report to corpus-report.json and prints a
 * summary.
 *
 * The suite asserts an agreement floor rather than per-case equality: the
 * corpus is intentionally full of edge cases we don't handle yet, and the
 * report is the tool for working through them. Raise MIN_AGREEMENT as
 * divergences get fixed; never lower it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../../src/parser';
import { Validator } from '../../../src/features/validator';
import { defaultSettings } from '../../../src/server/settings';
import { isHledgerAvailable, runHledgerCheck } from './hledgerRunner';

const corpusDir = path.join(__dirname, 'corpus');
const reportPath = path.join(__dirname, 'corpus-report.json');

const describeCorpus = isHledgerAvailable() ? describe : describe.skip;

// Ratchet: raise as divergences get fixed; never lower.
// Baseline 2026-07-29 against hledger 1.52.1: 75.8%
// 2026-07-29: 78.0% after fixing UTC/local date parsing and honouring a
// declared decimal mark for ambiguous digit groups.
// 2026-07-29: 81.4% after implementing balance assignments, per-group
// auto-balancing, and total (==) assertions.
// 2026-07-29: 86.0% after correcting cost inference and ignoring costs that
// duplicate a conversion posting pair.
// 2026-07-29: 87.5% after parsing leading-dot and scientific-notation amounts.
// 2026-07-29: 88.3% after excluding cost precision from the balance tolerance.
// 2026-07-29: 88.6% after fixing indented `#` and abutting status markers.
// 2026-07-29: 89.4% after parsing lot annotations after a cost, and costs on
// balance assertions. One false positive left: assertions-18.j needs
// multi-commodity amount inference, which the one-Amount-per-posting model
// cannot express.
// 2026-07-29: 92.1% after requiring opposite signs to infer a cost, balancing
// each group separately, and checking commodity directive syntax.
const MIN_AGREEMENT = 0.92;

interface CaseResult {
  file: string;
  verdict: 'agree-valid' | 'agree-invalid' | 'missed-error' | 'false-positive';
  hledgerError?: string;
  lspDiagnostics?: string[];
}

function disableAll(): typeof defaultSettings.validation {
  return {
    balance: false,
    requireExplicitCosts: false,
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
    commodityDirectives: false,
    includeFiles: false,
    circularIncludes: false,
    markAllUndeclaredInstances: true,
  };
}

describeCorpus('hledger corpus differential', () => {
  test('LSP verdicts vs hledger check', () => {
    const files = fs.readdirSync(corpusDir).filter(f => f.endsWith('.j')).sort();
    expect(files.length).toBeGreaterThan(0);

    const parser = new HledgerParser();
    const validator = new Validator();
    const results: CaseResult[] = [];

    for (const file of files) {
      const filePath = path.join(corpusDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const doc = TextDocument.create(URI.file(filePath).toString(), 'hledger', 1, content);

      // Ground truth: hledger's default checks (parseable, autobalanced, assertions)
      const hledgerResult = runHledgerCheck(filePath);

      // LSP with the equivalent checks enabled
      const parsed = parser.parse(doc);
      const lspResult = validator.validate(doc, parsed, {
        settings: {
          validation: {
            ...disableAll(),
            balance: true,
            balanceAssertions: true,
            missingAmounts: true,
            invalidDates: true,
            // hledger's parseable check rejects a malformed commodity directive,
            // so its LSP equivalent belongs in this set.
            commodityDirectives: true,
          },
        },
      });
      const lspErrors = lspResult.diagnostics.filter(d => d.severity === 1);

      let verdict: CaseResult['verdict'];
      if (hledgerResult.success && lspErrors.length === 0) verdict = 'agree-valid';
      else if (!hledgerResult.success && lspErrors.length > 0) verdict = 'agree-invalid';
      else if (!hledgerResult.success) verdict = 'missed-error';
      else verdict = 'false-positive';

      results.push({
        file,
        verdict,
        ...(hledgerResult.success ? {} : { hledgerError: hledgerResult.errors[0]?.message?.split('\n')[0] }),
        ...(lspErrors.length > 0 ? { lspDiagnostics: lspErrors.map(d => `${d.range.start.line + 1}: ${d.message}`) } : {}),
      });
    }

    const counts = {
      total: results.length,
      agreeValid: results.filter(r => r.verdict === 'agree-valid').length,
      agreeInvalid: results.filter(r => r.verdict === 'agree-invalid').length,
      missedError: results.filter(r => r.verdict === 'missed-error').length,
      falsePositive: results.filter(r => r.verdict === 'false-positive').length,
    };
    const agreement = (counts.agreeValid + counts.agreeInvalid) / counts.total;

    fs.writeFileSync(reportPath, JSON.stringify({ counts, agreement, results }, null, 2) + '\n');

    console.log(
      `hledger corpus differential: ${counts.total} journals — ` +
      `${counts.agreeValid} agree-valid, ${counts.agreeInvalid} agree-invalid, ` +
      `${counts.missedError} missed errors, ${counts.falsePositive} false positives ` +
      `(${(agreement * 100).toFixed(1)}% agreement). Details: ${path.relative(process.cwd(), reportPath)}`
    );

    expect(agreement).toBeGreaterThanOrEqual(MIN_AGREEMENT);
  }, 120000);
});
