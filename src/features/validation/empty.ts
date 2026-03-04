import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Transaction } from '../../types';
import { getTransactionRange } from './utils';

export function validateEmptyTransaction(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (transaction.postings.length < 2) {
        const range = getTransactionRange(transaction, document);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `Transaction has only ${transaction.postings.length} posting(s), minimum 2 required`,
            source: 'hledger'
        });
    }

    return diagnostics;
}

export function validateEmptyDescription(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (!transaction.description || transaction.description.trim() === '') {
        const range = getTransactionRange(transaction, document);
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range,
            message: 'Transaction has no description',
            source: 'hledger'
        });
    }

    return diagnostics;
}
