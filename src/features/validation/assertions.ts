import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Transaction, Posting } from '../../types';
import { formatAmount } from '../../utils/amountFormatter';
import { resolveIncludePath } from '../../utils/uri';
import { getEffectiveDate } from '../../utils/index';
import { getTransactionRange } from './utils';

export function findPostingRange(transaction: Transaction, posting: Posting, document: TextDocument): { start: { line: number; character: number }; end: { line: number; character: number } } {
    if (transaction.line !== undefined) {
        const text = document.getText();
        const lines = text.split('\n');

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
    return getTransactionRange(transaction, document);
}

export function validateBalanceAssertions(
    transactions: Transaction[],
    document: TextDocument,
    parsedDoc: ParsedDocument
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();
    const baseUri = URI.parse(document.uri);

    // Build a map from included file URI to the include directive's line number
    // This determines the ordering position for transactions from included files
    const includePositionMap = new Map<string, number>();
    for (const directive of parsedDoc.directives) {
        if (directive.type === 'include' && directive.line !== undefined) {
            // Resolve the include path to get the actual file URI
            const resolvedUri = resolveIncludePath(directive.value, baseUri);
            includePositionMap.set(resolvedUri.toString(), directive.line);
        }
    }

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
        // Determine the order position for this transaction
        let orderPosition: number;
        const txnSourceUri = transaction.sourceUri?.toString() || '';

        if (txnSourceUri === documentUri) {
            // Transaction is in the root file - use its own line number
            orderPosition = transaction.line ?? 0;
        } else {
            // Transaction is from an included file - use the include directive's line
            orderPosition = includePositionMap.get(txnSourceUri) ?? 0;
        }

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

    // Track running balances
    const runningBalances = new Map<string, Map<string, number>>();

    for (const { transaction, posting } of allPostings) {
        const account = posting.account;

        // Update balance if posting has amount
        if (posting.amount) {
            if (!runningBalances.has(account)) {
                runningBalances.set(account, new Map());
            }
            const commodityBalances = runningBalances.get(account)!;
            const commodity = posting.amount.commodity || '';
            const currentBalance = commodityBalances.get(commodity) || 0;
            const newBalance = currentBalance + posting.amount.quantity;
            commodityBalances.set(commodity, newBalance);
        }

        // Check assertion (only for current document)
        if (posting.assertion && transaction.sourceUri?.toString() === documentUri) {
            const assertedCommodity = posting.assertion.commodity || '';
            const assertedAmount = posting.assertion.quantity;
            const actualBalance = runningBalances.get(account)?.get(assertedCommodity) || 0;

            // Allow for small floating point errors
            if (Math.abs(actualBalance - assertedAmount) > 0.005) {
                const range = findPostingRange(transaction, posting, document);
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
