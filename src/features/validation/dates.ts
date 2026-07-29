import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { Transaction } from '../../types';
import { isFromDocument } from '../../utils/index';
import { getTransactionRange } from './utils';

// YYYY-M-D, YYYY/M/D or YYYY.M.D, with a consistent separator and 1- or 2-digit
// month and day. hledger accepts all three separators but requires the same one
// throughout, which the backreference enforces: `2024-01/05` is rejected.
const DATE_PATTERN = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/;

/**
 * Split a date string into its numeric components, or null if it is not a
 * well-formed hledger date.
 */
function splitDate(dateStr: string): { year: number, month: number, day: number } | null {
    const match = dateStr.trim().match(DATE_PATTERN);
    if (!match) {
        return null;
    }
    return {
        year: parseInt(match[1], 10),
        month: parseInt(match[3], 10),
        day: parseInt(match[4], 10)
    };
}

/**
 * Parse a date string to UTC midnight. Returns null if the string is malformed
 * or names a date that does not exist in the calendar.
 *
 * Components are combined with Date.UTC rather than handed to `new Date(string)`:
 * only the zero-padded "YYYY-MM-DD" form is an ISO date string parsed as UTC.
 * "2011-5-5" falls back to implementation-defined parsing as *local* time, which
 * shifts the UTC calendar day in any timezone with a non-zero offset — so
 * hledger's valid single-digit dates were reported as non-existent.
 */
export function parseDate(dateStr: string): Date | null {
    const parts = splitDate(dateStr);
    if (!parts) {
        return null;
    }

    const { year, month, day } = parts;
    const date = new Date(Date.UTC(year, month - 1, day));

    // Date.UTC rolls impossible dates forward (Feb 29 2001 → Mar 1), so confirm
    // the components survived the round trip.
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day) {
        return null;
    }

    return date;
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
    const invalid = (message: string): Diagnostic[] => [{
        severity: DiagnosticSeverity.Error,
        range: getTransactionRange(transaction, lines),
        message,
        source: 'hledger'
    }];

    const parts = splitDate(transaction.date);

    if (!parts) {
        return invalid(`Invalid date format: ${transaction.date}`);
    }

    // Check if values are in valid ranges
    if (parts.month < 1 || parts.month > 12) {
        return invalid(`Invalid month in date: ${transaction.date} (month must be 1-12)`);
    }

    if (parts.day < 1 || parts.day > 31) {
        return invalid(`Invalid day in date: ${transaction.date} (day must be 1-31)`);
    }

    // The shape and ranges are fine, so the only remaining failure is a day that
    // does not exist in that month (e.g. Feb 29 in a non-leap year).
    if (!parseDate(transaction.date)) {
        return invalid(`Invalid date: ${transaction.date} (date does not exist in calendar)`);
    }

    return [];
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
