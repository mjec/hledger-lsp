import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../../src/parser/index';
import { Validator } from '../../../src/features/validator';
import {
    resolveBalanceAssignments,
    validateBalanceAssignmentRules
} from '../../../src/features/validation/balanceAssignments';

const URI_STRING = 'file:///t.journal';

/** Parse, resolve assignments, then collect assignment-rule diagnostics. */
function diagnose(text: string) {
    const doc = TextDocument.create(URI_STRING, 'hledger', 1, text);
    const parsed = new HledgerParser().parse(doc);
    resolveBalanceAssignments(parsed, URI.parse(URI_STRING).toString(), URI.parse(URI_STRING));

    const lines = text.split('\n');
    return parsed.transactions.flatMap(t => validateBalanceAssignmentRules(t, lines));
}

describe('validateBalanceAssignmentRules', () => {
    // hledger: "Balance assignments and custom posting dates may not be combined."
    // Corpus assertions-12.j.
    it('reports an assignment that carries a custom posting date', () => {
        const diagnostics = diagnose('2013/1/1\n  a    $1  =$1\n  b         =$-1  ; date:2012/1/1\n');

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toContain('Balance assignments and custom posting dates may not be combined');
    });

    it('points at the offending posting line', () => {
        const diagnostics = diagnose('2013/1/1\n  a    $1  =$1\n  b         =$-1  ; date:2012/1/1\n');

        expect(diagnostics[0].range.start.line).toBe(2);
    });

    it('accepts an assignment with no posting date', () => {
        expect(diagnose('2013/1/1\n  a  = $5\n  b\n')).toEqual([]);
    });

    it('accepts a posting date on a posting that is not an assignment', () => {
        expect(diagnose('2013/1/1\n  a  $5  ; date:2012/1/1\n  b\n')).toEqual([]);
    });

    it('accepts a posting date alongside an assertion that has a written amount', () => {
        // A written amount makes this an assertion, not an assignment, so the
        // prohibition does not apply.
        expect(diagnose('2013/1/1\n  a  $5  =$5  ; date:2012/1/1\n  b\n')).toEqual([]);
    });
});

describe('an invalid assignment does not cascade consequential errors', () => {
    function allMessages(text: string): string[] {
        const doc = TextDocument.create(URI_STRING, 'hledger', 1, text);
        const parsed = new HledgerParser().parse(doc);
        return new Validator().validate(doc, parsed, {
            settings: { validation: { balance: true, balanceAssertions: true, missingAmounts: true } }
        }).diagnostics.map(d => d.message);
    }

    // hledger refuses to resolve an assignment that carries a posting date, and
    // reports only the prohibition. Inferring an amount anyway makes the
    // transaction look unbalanced by the inferred figure — an error hledger never
    // reports, caused entirely by an inference it declined to make.
    const text = '2024-01-15 Deposit\n    assets:checking  $100\n    income:salary\n'
        + '\n2024-01-10 Purchase\n    expenses:food  $10  ; date:2024-01-14\n'
        + '    assets:checking  = $100  ; date:2024-01-14\n';

    it('still reports the prohibition', () => {
        expect(allMessages(text)).toContainEqual(
            expect.stringContaining('Balance assignments and custom posting dates may not be combined')
        );
    });

    it('does not report an imbalance caused by the refused inference', () => {
        expect(allMessages(text).filter(m => m.includes('does not balance'))).toEqual([]);
    });

    it('does not report the posting as a missing amount either', () => {
        expect(allMessages(text).filter(m => m.includes('without amounts'))).toEqual([]);
    });
});
