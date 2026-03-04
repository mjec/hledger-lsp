import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Transaction } from '../../types';
import { getTransactionRange } from './utils';

export function validateExplicitCosts(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Check if any posting has an inferred cost (set by inferCosts during parsing)
    const hasInferredCost = transaction.postings.some(p => p.cost?.inferred);
    if (hasInferredCost) {
        // Collect the commodities involved for the error message
        const commodities = new Set<string>();
        for (const posting of transaction.postings) {
            if (posting.amount?.commodity) {
                commodities.add(posting.amount.commodity);
            }
        }

        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: getTransactionRange(transaction, document),
            message: `Multi-commodity transaction requires explicit cost notation (@ or @@). Commodities: ${[...commodities].join(', ')}`,
            source: 'hledger'
        });
    }

    return diagnostics;
}
