import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Transaction, Posting } from '../../types';
import { formatAmount } from '../../utils/amountFormatter';
import { getEffectiveDate, isFromDocument } from '../../utils/index';
import { amountPrecision, balanceTolerance } from '../../utils/balanceCalculator';
import { getTransactionRange } from './utils';
import { buildIncludePositionMap, transactionOrderPosition } from './journalOrder';

export function findPostingRange(transaction: Transaction, posting: Posting, lines: string[]): { start: { line: number; character: number }; end: { line: number; character: number } } {
    if (transaction.line !== undefined) {
        // Search for the posting within the transaction's lines
        for (let i = transaction.line + 1; i < lines.length; i++) {
            const line = lines[i];

            // Stop if we hit another transaction or empty line
            if (!line.trim() || line.match(/^\d{4}[-/]\d{2}[-/]\d{2}/)) {
                break;
            }

            if (line.trim().startsWith(posting.account)) {
                return {
                    start: { line: i, character: 0 },
                    end: { line: i, character: line.length }
                };
            }
        }
    }

    // Fallback to transaction range
    return getTransactionRange(transaction, lines);
}

export function validateBalanceAssertions(
    transactions: Transaction[],
    lines: string[],
    parsedDoc: ParsedDocument,
    documentUri: string,
    document: TextDocument
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const baseUri = URI.parse(document.uri);

    // Ordering position per source file; shared with the balance-assignment
    // pre-pass so the two cannot disagree about journal order.
    const includePositionMap = buildIncludePositionMap(parsedDoc, baseUri);

    // Extract all postings with effective dates and ordering info
    interface PostingWithContext {
        transaction: Transaction;
        posting: Posting;
        effectiveDate: string;
        orderPosition: number;  // Line number for ordering (include line or transaction line)
        lineInFile: number;     // Line within source file for secondary ordering
    }

    const allPostings: PostingWithContext[] = [];

    for (const transaction of transactions) {
        const orderPosition = transactionOrderPosition(transaction, documentUri, includePositionMap);

        const lineInFile = transaction.line ?? 0;

        for (const posting of transaction.postings) {
            allPostings.push({
                transaction,
                posting,
                effectiveDate: getEffectiveDate(posting, transaction),
                orderPosition,
                lineInFile
            });
        }
    }

    // Sort by: 1) effective date, 2) order position, 3) line within file
    allPostings.sort((a, b) => {
        // Primary: sort by date
        const dateCompare = a.effectiveDate.localeCompare(b.effectiveDate);
        if (dateCompare !== 0) return dateCompare;

        // Secondary: sort by order position (include line or transaction line in root)
        const positionCompare = a.orderPosition - b.orderPosition;
        if (positionCompare !== 0) return positionCompare;

        // Tertiary: sort by line within source file (for multiple transactions in same included file)
        return a.lineInFile - b.lineInFile;
    });

    // Track running balances and the max decimal precision seen per
    // account+commodity. hledger compares assertions exactly (not at display
    // precision), so the comparison tolerance only needs to absorb float
    // noise: half a unit in the last place of the finest precision involved.
    const runningBalances = new Map<string, Map<string, number>>();
    const runningPrecisions = new Map<string, Map<string, number>>();

    for (const { transaction, posting } of allPostings) {
        const account = posting.account;

        // Update balance if posting has amount
        if (posting.amount) {
            if (!runningBalances.has(account)) {
                runningBalances.set(account, new Map());
                runningPrecisions.set(account, new Map());
            }
            const commodityBalances = runningBalances.get(account)!;
            const commodity = posting.amount.commodity || '';
            const currentBalance = commodityBalances.get(commodity) || 0;
            const newBalance = currentBalance + posting.amount.quantity;
            commodityBalances.set(commodity, newBalance);

            const commodityPrecisions = runningPrecisions.get(account)!;
            const precision = amountPrecision(posting.amount);
            if (precision > (commodityPrecisions.get(commodity) ?? -1)) {
                commodityPrecisions.set(commodity, precision);
            }
        }

        // A balance assignment's amount was inferred *to* satisfy its assertion,
        // so the assertion holds by construction and hledger never reports it.
        // Re-checking it here would also disagree with the inference, which sees
        // the balance before the transaction's auto-balanced postings exist.
        if (posting.isBalanceAssignment) {
            continue;
        }

        // Check assertion (only for current document)
        if (posting.assertion && isFromDocument(transaction, documentUri)) {
            const assertedCommodity = posting.assertion.commodity || '';
            const assertedAmount = posting.assertion.quantity;
            const actualBalance = runningBalances.get(account)?.get(assertedCommodity) || 0;

            const trackedPrecision = runningPrecisions.get(account)?.get(assertedCommodity) ?? 0;
            const precision = Math.max(trackedPrecision, amountPrecision(posting.assertion));
            if (Math.abs(actualBalance - assertedAmount) > balanceTolerance(precision)) {
                const range = findPostingRange(transaction, posting, lines);
                const expectedFormatted = formatAmount(assertedAmount, assertedCommodity, parsedDoc);
                const actualFormatted = formatAmount(actualBalance, assertedCommodity, parsedDoc);

                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range,
                    message: `Balance assertion failed for ${account}: expected ${expectedFormatted}, but calculated ${actualFormatted}`,
                    source: 'hledger'
                });
            }
        }
    }

    return diagnostics;
}
