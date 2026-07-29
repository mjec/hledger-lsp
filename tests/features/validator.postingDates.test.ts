import { Validator } from '../../src/features/validator';
import { HledgerParser } from '../../src/parser';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';

describe('Validator with Posting Dates', () => {
  let parser: HledgerParser;
  let validator: Validator;

  beforeEach(() => {
    parser = new HledgerParser();
    validator = new Validator();
  });

  describe('Balance assertions with posting dates', () => {
    test('assertion passes when posting date is after transaction date', () => {
      const content = `
2024-01-15 Deposit
    assets:checking  $100
    income:salary

2024-01-10 Purchase (entered late)
    expenses:food  $10  ; date:2024-01-16
    assets:checking      ; date:2024-01-16  = $90
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // Assertion should pass: at effective date 01-16, balance is $100 - $10 = $90
      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      );
      expect(assertionErrors).toHaveLength(0);
    });

    test('assertion fails when effective date ordering differs from transaction ordering', () => {
      // The asserting posting states an amount, so this is a balance assertion.
      // hledger 1.52.1 reports "asserted balance is $10 but calculated $15",
      // because the $5 posting dated 2012 is counted first.
      const content = `
2013-01-01 Opening
    a   $10  = $10
    b

2013-01-02 Backdated posting
    a   $5   ; date:2012-01-01
    c
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      );
      expect(assertionErrors.length).toBeGreaterThan(0);
      expect(assertionErrors[0].message).toContain('expected $10');
    });

    test('a balance assignment may not carry a custom posting date', () => {
      // Previously this journal was expected to produce a failed *assertion*. It
      // is a balance *assignment* (no amount stated), and hledger 1.52.1 rejects
      // the combination outright rather than evaluating it:
      //   "Balance assignments and custom posting dates may not be combined."
      const content = `
2024-01-15 Deposit
    assets:checking  $100
    income:salary

2024-01-10 Purchase
    expenses:food  $10  ; date:2024-01-14
    assets:checking  = $100  ; date:2024-01-14
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      expect(result.diagnostics.map((d: Diagnostic) => d.message)).toContainEqual(
        expect.stringContaining('Balance assignments and custom posting dates may not be combined')
      );
      expect(result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      )).toHaveLength(0);
    });

    test('hledger documentation example - bank clearing date', () => {
      const content = `
2015/05/30
    expenses:food     $10  ; food purchased on saturday 5/30
    assets:checking        ; bank cleared it on monday, date:6/1

2015/05/31
    expenses:food      0 = $10
    assets:checking    0 = $0  ; checking balance still $0 on 5/31

2015/06/01
    expenses:food      0 = $10
    assets:checking    0 = $-10  ; checking cleared on 6/1
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      // All assertions should pass
      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed') && d.severity === DiagnosticSeverity.Error
      );
      expect(assertionErrors).toHaveLength(0);
    });

    test('posting date before transaction date', () => {
      const content = `
2024-01-20 Late Entry
    expenses:food  $50  ; date:2024-01-15
    assets:cash         ; date:2024-01-15

2024-01-18 Check balance
    assets:cash  0 = $-50  ; Cash was debited on 01-15, before this transaction
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      );
      expect(assertionErrors).toHaveLength(0);
    });

    test('multiple postings with different dates in same transaction', () => {
      const content = `
2024-01-15 Transaction with staggered dates
    expenses:food  $10  ; date:2024-01-16
    expenses:gas   $20  ; date:2024-01-18
    assets:cash          ; clears on transaction date 01-15

2024-01-17 Check balances
    expenses:food   0 = $10   ; Food already recorded on 01-16
    expenses:gas    0 = $0    ; Gas not yet recorded (happens on 01-18)
    assets:cash     0 = $-30  ; Cash cleared on 01-15
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      );
      expect(assertionErrors).toHaveLength(0);
    });

    test('cross-boundary posting dates with mixed formats', () => {
      const content = `
2024/01/20 Transaction with slash format
    assets:checking  $100
    income:salary

2024-01-15 Transaction with dash format
    expenses:food  $10
    assets:checking  ; date:2024-01-25

2024-01-22 Check balances between dates
    assets:checking  0 = $100  ; Only the 01-20 deposit has cleared
    expenses:food    0 = $10   ; Food expense recorded on 01-15
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      );
      expect(assertionErrors).toHaveLength(0);
    });

    test('user test case from posting-date-test.journal', () => {
      const content = `account expenses:food
account assets:checking
commodity $

2015/05/30 |
    expenses:food                              $  10;food purchased on saturday 5/30
    assets:checking                            $- 10;bank cleared it on monday, date:6/1

2015/05/31 |
    expenses:food                                  0 = $ 10
    assets:checking                                0 = $  0;should pass - checking clears on 6/1

2015/06/01 |
    expenses:food                                  0 = $  10
    assets:checking                                0 = $- 10`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      );
      expect(assertionErrors).toHaveLength(0);
    });
  });

  describe('Backward compatibility', () => {
    test('balance assertions without posting dates still work', () => {
      const content = `
2024-01-15 Transaction A
    expenses:food  $10
    assets:checking

2024-01-20 Transaction B
    assets:checking  $100 = $90
    income:salary
`;

      const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
      const parsedDoc = parser.parse(doc);
      const result = validator.validate(doc, parsedDoc);

      const assertionErrors = result.diagnostics.filter((d: Diagnostic) =>
        d.message.includes('Balance assertion failed')
      );
      expect(assertionErrors).toHaveLength(0);
    });
  });
});
