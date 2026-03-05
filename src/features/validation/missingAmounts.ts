import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { Transaction, PeriodicTransaction } from '../../types';
import { getLineRange, getTransactionRange } from './utils';

export function validateMissingAmounts(transaction: Transaction, lines: string[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Exclude unbalanced virtual postings — they don't participate in balancing
    const realPostings = transaction.postings.filter(p => p.virtual !== 'unbalanced');
    const postingsWithoutAmounts = realPostings.filter(p => !p.amount);

    if (postingsWithoutAmounts.length > 1) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: getTransactionRange(transaction, lines),
            message: `Transaction has ${postingsWithoutAmounts.length} postings without amounts (maximum 1 allowed)`,
            source: 'hledger'
        });
    }

    return diagnostics;
}

export function validatePeriodicTransactionMissingAmounts(periodicTx: PeriodicTransaction, lines: string[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const realPostings = periodicTx.postings.filter(p => p.virtual !== 'unbalanced');
    const postingsWithoutAmounts = realPostings.filter(p => !p.amount);

    if (postingsWithoutAmounts.length > 1) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: getLineRange(periodicTx.line ?? 0, lines),
            message: `Periodic transaction has ${postingsWithoutAmounts.length} postings without amounts (maximum 1 allowed)`,
            source: 'hledger'
        });
    }

    return diagnostics;
}
