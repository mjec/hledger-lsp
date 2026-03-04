import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Transaction, PeriodicTransaction } from '../../types';
import { calculateTransactionBalance } from '../../utils/balanceCalculator';
import { formatAmount } from '../../utils/amountFormatter';
import { getLineRange, getTransactionRange } from './utils';

export function validateBalance(transaction: Transaction, document: TextDocument, parsedDoc: ParsedDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Calculate transaction balance by commodity
    const balances = calculateTransactionBalance(transaction);

    // Count how many real (non-virtual-unbalanced) postings have explicit amounts
    const realPostings = transaction.postings.filter(p => p.virtual !== 'unbalanced');
    let postingsWithExplicitAmounts = 0;
    for (const posting of realPostings) {
        if (posting.amount && !posting.amount.inferred) {
            postingsWithExplicitAmounts++;
        }
    }

    // If all real postings have explicit amounts, check if they balance
    // (skip checking for transactions with inferred amounts)
    if (postingsWithExplicitAmounts === realPostings.length) {
        for (const [commodity, balance] of balances.entries()) {
            // Allow for small floating point errors
            if (Math.abs(balance) > 0.005) {
                const formattedBalance = commodity
                    ? formatAmount(balance, commodity, parsedDoc)
                    : balance.toFixed(2);
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: getTransactionRange(transaction, document),
                    message: `Transaction does not balance: ${formattedBalance} off`,
                    source: 'hledger'
                });
            }
        }
    }

    return diagnostics;
}

export function validatePeriodicTransactionBalance(periodicTx: PeriodicTransaction, document: TextDocument, parsedDoc: ParsedDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    // Reuse the same balance calculation logic
    const tempTransaction: Transaction = {
        date: '',
        description: '',
        payee: '',
        note: '',
        postings: periodicTx.postings,
        line: periodicTx.line,
    };
    const balances = calculateTransactionBalance(tempTransaction);

    const realPostings = periodicTx.postings.filter(p => p.virtual !== 'unbalanced');
    let postingsWithExplicitAmounts = 0;
    for (const posting of realPostings) {
        if (posting.amount && !posting.amount.inferred) {
            postingsWithExplicitAmounts++;
        }
    }

    if (postingsWithExplicitAmounts === realPostings.length) {
        for (const [commodity, balance] of balances.entries()) {
            if (Math.abs(balance) > 0.005) {
                const formattedBalance = commodity
                    ? formatAmount(balance, commodity, parsedDoc)
                    : balance.toFixed(2);
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: getLineRange(periodicTx.line ?? 0, document),
                    message: `Periodic transaction does not balance: ${formattedBalance} off`,
                    source: 'hledger'
                });
            }
        }
    }

    return diagnostics;
}
