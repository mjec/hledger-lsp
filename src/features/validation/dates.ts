import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { Transaction } from '../../types';
import { isFromDocument } from '../../utils/index';
import { getTransactionRange } from './utils';

export function parseDate(dateStr: string): Date | null {
    // Handle both YYYY-MM-DD and YYYY/MM/DD formats
    const normalized = dateStr.replace(/\//g, '-');
    const date = new Date(normalized);
    return isNaN(date.getTime()) ? null : date;
}

export function validateDateOrdering(transactions: Transaction[], lines: string[], documentUri: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Only validate transactions in the current document
    const documentTransactions = transactions.filter(t => isFromDocument(t, documentUri));

    for (let i = 1; i < documentTransactions.length; i++) {
        const prevDate = parseDate(documentTransactions[i - 1].date);
        const currDate = parseDate(documentTransactions[i].date);

        if (prevDate && currDate && currDate < prevDate) {
            const range = getTransactionRange(documentTransactions[i], lines);
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range,
                message: `Transaction date ${documentTransactions[i].date} is before previous transaction date ${documentTransactions[i - 1].date}`,
                source: 'hledger'
            });
        }
    }

    return diagnostics;
}

export function validateDateFormat(transaction: Transaction, lines: string[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const normalized = transaction.date.replace(/\//g, '-');
    const parts = normalized.split('-');

    if (parts.length !== 3) {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `Invalid date format: ${transaction.date}`,
            source: 'hledger'
        });
        return diagnostics;
    }

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    // Check if values are in valid ranges
    if (month < 1 || month > 12) {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `Invalid month in date: ${transaction.date} (month must be 1-12)`,
            source: 'hledger'
        });
        return diagnostics;
    }

    if (day < 1 || day > 31) {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `Invalid day in date: ${transaction.date} (day must be 1-31)`,
            source: 'hledger'
        });
        return diagnostics;
    }

    // Now try to parse the date
    const parsedDate = parseDate(transaction.date);

    if (!parsedDate) {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `Invalid date format: ${transaction.date}`,
            source: 'hledger'
        });
        return diagnostics;
    }

    // Check if the date components match the parsed date
    // This catches cases like Feb 30 which get corrected to Mar 2
    // Use UTC getters to match the UTC parsing of "YYYY-MM-DD" format
    // This ensures correct validation regardless of timezone
    if (parsedDate.getUTCFullYear() !== year ||
        parsedDate.getUTCMonth() + 1 !== month ||
        parsedDate.getUTCDate() !== day) {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `Invalid date: ${transaction.date} (date does not exist in calendar)`,
            source: 'hledger'
        });
    }

    return diagnostics;
}

export function validateFutureDate(transaction: Transaction, lines: string[], now?: Date): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const parsedDate = parseDate(transaction.date);
    if (!parsedDate) {
        return diagnostics; // Already handled by validateDateFormat
    }

    // Build "today" as UTC midnight using the local calendar date.
    // parseDate() returns UTC midnight for "YYYY-MM-DD", so we need today
    // as UTC midnight too for correct comparison — but derived from the
    // *local* date, since "today" is inherently a local concept (issue #11).
    const currentTime = now ?? new Date();
    const today = new Date(Date.UTC(currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate()));

    if (parsedDate > today) {
        const range = getTransactionRange(transaction, lines);
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range,
            message: `Transaction date ${transaction.date} is in the future`,
            source: 'hledger'
        });
    }

    return diagnostics;
}
