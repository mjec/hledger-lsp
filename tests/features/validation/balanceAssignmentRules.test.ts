import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../../src/parser/index';
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
