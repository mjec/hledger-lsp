import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { Transaction } from '../../types';
import { getTransactionRange } from './utils';

export function validateEmptyTransaction(transaction: Transaction, lines: string[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // hledger imposes no minimum posting count - it only requires the postings
    // to sum to zero, which validateBalance covers. A single posting of $0.00
    // (typically carrying a balance assertion to record a statement) is valid.
    // Only a transaction with no postings at all is worth reporting, and since
    // hledger accepts that too it is a warning, matching the periodic
    // transaction check in validator.ts.
    if (transaction.postings.length === 0) {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range,
            message: 'Transaction has no postings',
            source: 'hledger'
        });
    }

    return diagnostics;
}

export function validateEmptyDescription(transaction: Transaction, lines: string[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (!transaction.description || transaction.description.trim() === '') {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range,
            message: 'Transaction has no description',
            source: 'hledger'
        });
    }

    return diagnostics;
}
