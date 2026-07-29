/**
 * Precision-aware balance and assertion validation.
 *
 * hledger semantics (verified against hledger 1.52.1):
 * - A transaction balances iff, per commodity, the residue rounds to zero at
 *   that commodity's transaction-local precision (max decimal places among the
 *   transaction's amounts in that commodity, including cost amounts).
 *   Journal-wide or declared commodity precision does NOT affect balancing.
 * - Balance assertions are compared exactly, not at display precision.
 */

import { Validator } from '../../src/features/validator';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('precision-aware validation', () => {
  let validator: Validator;
  let parser: HledgerParser;

  beforeEach(() => {
    validator = new Validator();
    parser = new HledgerParser();
  });

  function balanceErrors(content: string) {
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsedDoc = parser.parse(doc);
    const result = validator.validate(doc, parsedDoc);
    return result.diagnostics.filter(d => d.message.includes('does not balance'));
  }

  function assertionErrors(content: string) {
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsedDoc = parser.parse(doc);
    const result = validator.validate(doc, parsedDoc);
    return result.diagnostics.filter(d => d.message.includes('Balance assertion failed'));
  }

  describe('transaction balance', () => {
    test('flags an 8-decimal-place imbalance', () => {
      const errors = balanceErrors(`2024-01-01 tiny imbalance
    assets:btc    0.00000002 BTC
    equity:open  -0.00000001 BTC`);
      expect(errors).toHaveLength(1);
    });

    test('flags a 3-decimal-place residue below the old 0.005 tolerance', () => {
      const errors = balanceErrors(`2024-01-01 three dp
    a    1.001 USD
    b   -1.00 USD`);
      expect(errors).toHaveLength(1);
    });

    test('flags whole-number amounts off by one', () => {
      const errors = balanceErrors(`2024-01-01 whole numbers
    a    3 X
    b   -2 X`);
      expect(errors).toHaveLength(1);
    });

    test('accepts exactly balanced 2dp amounts (0.10 + 0.20 - 0.30)', () => {
      const errors = balanceErrors(`2024-01-01 exact decimal
    a    0.10 USD
    a    0.20 USD
    b   -0.30 USD`);
      expect(errors).toHaveLength(0);
    });

    test('accepts a half-ULP cost residue at the commodity precision', () => {
      // 2.5 FOO @ 1.25 USD = 3.125 USD vs -3.12 USD → residue 0.005 USD.
      // USD amounts in the transaction have 2dp, and hledger rounds the
      // residue at 2dp (half-to-even): 0.005 → 0.00, so this balances.
      const errors = balanceErrors(`2024-01-01 cost residue
    a    2.5 FOO @ 1.25 USD
    b   -3.12 USD`);
      expect(errors).toHaveLength(0);
    });

    test('flags a cost residue exceeding half-ULP at the commodity precision', () => {
      // 0.25 FOO @ 1.25 USD = 0.3125 USD vs -0.30 USD → residue 0.0125 USD,
      // which rounds to 0.01 at 2dp → unbalanced.
      const errors = balanceErrors(`2024-01-01 cost residue too big
    a    0.25 FOO @ 1.25 USD
    b   -0.30 USD`);
      expect(errors).toHaveLength(1);
    });

    test('journal-wide precision does not affect transaction-local balancing', () => {
      // Another transaction uses 4dp USD, but the cost-residue transaction
      // still balances at its own 2dp precision (verified against hledger).
      const errors = balanceErrors(`2024-01-01 unrelated high precision
    x    0.0001 USD
    y   -0.0001 USD

2024-01-02 cost residue
    a    2.5 FOO @ 1.25 USD
    b   -3.12 USD`);
      expect(errors).toHaveLength(0);
    });
  });

  describe('balance assertions', () => {
    test('flags an assertion difference below the old 0.005 tolerance', () => {
      // hledger compares assertions exactly: 100.004 ≠ 100 fails.
      const errors = assertionErrors(`2024-01-01 setup
    assets:cash   100.004 USD
    equity:open  -100.004 USD

2024-01-02 assert
    assets:cash   0 USD = 100 USD
    equity:open   0 USD`);
      expect(errors).toHaveLength(1);
    });

    test('flags an 8-decimal-place assertion mismatch', () => {
      const errors = assertionErrors(`2024-01-01 btc
    assets:btc    0.00000001 BTC
    equity:open  -0.00000001 BTC

2024-01-02 assert
    assets:btc    0.00000001 BTC = 0.00000003 BTC
    equity:open  -0.00000001 BTC`);
      expect(errors).toHaveLength(1);
    });

    test('accepts an exact 8-decimal-place assertion after accumulation', () => {
      const errors = assertionErrors(`2024-01-01 btc
    assets:btc    0.00000001 BTC
    equity:open  -0.00000001 BTC

2024-01-02 more btc
    assets:btc    0.00000002 BTC = 0.00000003 BTC
    equity:open  -0.00000002 BTC`);
      expect(errors).toHaveLength(0);
    });

    test('accepts an exact assertion built from many float-noisy postings', () => {
      // 0.10 added ten times is not exactly 1.0 in binary floating point;
      // the comparison must absorb float noise below the tracked precision.
      const postings = Array.from({ length: 10 }, (_, i) =>
        `2024-01-${String(i + 1).padStart(2, '0')} drip
    assets:cash    0.10 USD
    equity:open   -0.10 USD`).join('\n\n');
      const errors = assertionErrors(`${postings}

2024-01-15 assert
    assets:cash   0 USD = 1.00 USD
    equity:open   0 USD`);
      expect(errors).toHaveLength(0);
    });
  });
});
