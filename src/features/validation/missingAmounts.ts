import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { Posting, Transaction, PeriodicTransaction } from '../../types';
import { getLineRange, getTransactionRange } from './utils';

function validateMissingAmountsImpl(
    postings: Posting[],
    lines: string[],
    label: string,
    getRange: (lines: string[]) => { start: { line: number; character: number }; end: { line: number; character: number } }
): Diagnostic[] {
    const realPostings = postings.filter(p => p.virtual !== 'unbalanced');
    const postingsWithoutAmounts = realPostings.filter(p => !p.amount);

    if (postingsWithoutAmounts.length > 1) {
        return [{
            severity: DiagnosticSeverity.Error,
            range: getRange(lines),
            message: `${label} has ${postingsWithoutAmounts.length} postings without amounts (maximum 1 allowed)`,
            source: 'hledger'
        }];
    }

    return [];
}

export function validateMissingAmounts(transaction: Transaction, lines: string[]): Diagnostic[] {
    return validateMissingAmountsImpl(
        transaction.postings, lines,
        'Transaction', (ls) => getTransactionRange(transaction, ls)
    );
}

export function validatePeriodicTransactionMissingAmounts(periodicTx: PeriodicTransaction, lines: string[]): Diagnostic[] {
    return validateMissingAmountsImpl(
        periodicTx.postings, lines,
        'Periodic transaction', (ls) => getLineRange(periodicTx.line ?? 0, ls)
    );
}
