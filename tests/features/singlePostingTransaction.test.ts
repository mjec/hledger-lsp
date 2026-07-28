import { Validator } from '../../src/features/validator';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Regression tests for hledger-vscode issue #101: single-posting transactions.
//
// hledger itself accepts a transaction with a single posting as long as the
// transaction balances - a lone $0.00 posting (typically carrying a balance
// assertion, used to record a statement) sums to zero and is valid. Verified
// against hledger 1.x: `hledger check` exits 0 for these journals, and errors
// with "This transaction is unbalanced" - not a posting-count complaint - when
// the single posting has a non-zero amount.
describe('single posting transactions (issue #101)', () => {
  let validator: Validator;
  let parser: HledgerParser;

  const diagnose = (content: string) => {
    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    return validator.validate(doc, parser.parse(doc)).diagnostics;
  };

  beforeEach(() => {
    validator = new Validator();
    parser = new HledgerParser();
  });

  test('should accept a zero-amount posting with a balance assertion', () => {
    const diagnostics = diagnose(`2026-07-21 * Statement
    Asset:Checking:Institution        $0.00 = $1,234.99`);

    const postingCountErrors = diagnostics.filter(d => d.message.includes('minimum 2 required'));
    expect(postingCountErrors).toHaveLength(0);
  });

  test('should accept a zero-amount posting without a balance assertion', () => {
    const diagnostics = diagnose(`2026-07-21 * Statement
    Asset:Checking:Institution        $0.00`);

    const postingCountErrors = diagnostics.filter(d => d.message.includes('minimum 2 required'));
    expect(postingCountErrors).toHaveLength(0);
  });

  test('should report an unbalanced transaction, not a posting count, for a non-zero lone posting', () => {
    const diagnostics = diagnose(`2026-07-21 * Bad
    Asset:Checking:Institution        $5.00`);

    const postingCountErrors = diagnostics.filter(d => d.message.includes('minimum 2 required'));
    expect(postingCountErrors).toHaveLength(0);

    const balanceErrors = diagnostics.filter(d => d.message.includes('does not balance'));
    expect(balanceErrors.length).toBeGreaterThan(0);
  });
});
