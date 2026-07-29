import { URI } from 'vscode-uri';
import { ParsedDocument, Posting, Transaction } from '../../types';
import { resolveIncludePath } from '../../utils/uri';
import { getEffectiveDate } from '../../utils/index';

/**
 * Journal ordering for running-balance purposes.
 *
 * Balances accumulate in the order hledger reads the journal, which for a
 * workspace means: transactions in the root file at their own line, and
 * transactions from an included file at the position of its `include` directive.
 * Both the balance-assignment pre-pass and the assertion check need this, and
 * they must not drift apart, so the ordering lives here.
 */

/** Map from included file URI to the line of the `include` directive that pulled it in. */
export function buildIncludePositionMap(parsedDoc: ParsedDocument, baseUri: URI): Map<string, number> {
    const includePositions = new Map<string, number>();

    for (const directive of parsedDoc.directives) {
        if (directive.type === 'include' && directive.line !== undefined) {
            const resolvedUri = resolveIncludePath(directive.value, baseUri);
            includePositions.set(resolvedUri.toString(), directive.line);
        }
    }

    return includePositions;
}

/**
 * The ordering position of a transaction: its own line when it lives in the root
 * document, otherwise the line of the include directive that brought it in.
 */
export function transactionOrderPosition(
    transaction: Transaction,
    documentUri: string,
    includePositions: Map<string, number>
): number {
    const sourceUri = transaction.sourceUri?.toString() || '';

    if (sourceUri === documentUri) {
        return transaction.line ?? 0;
    }

    return includePositions.get(sourceUri) ?? 0;
}

/** A posting together with everything needed to place it in journal order. */
export interface OrderedPosting {
    transaction: Transaction;
    posting: Posting;
    effectiveDate: string;
    orderPosition: number;
    lineInFile: number;
}

/**
 * Every posting of the given transactions in the order balances accumulate:
 * by effective date, then include position, then line within the source file.
 *
 * The *effective* date is the posting's own date when it has one. hledger orders
 * by that, not by the transaction date — verified against hledger 1.52.1, where a
 * posting carrying `date:2012/1/1` is counted before an assertion dated 2013,
 * and where it changes which amount a balance assignment infers.
 */
export function orderPostings(
    transactions: Transaction[],
    documentUri: string,
    includePositions: Map<string, number>
): OrderedPosting[] {
    const ordered: OrderedPosting[] = [];

    for (const transaction of transactions) {
        const orderPosition = transactionOrderPosition(transaction, documentUri, includePositions);

        for (const posting of transaction.postings) {
            ordered.push({
                transaction,
                posting,
                effectiveDate: getEffectiveDate(posting, transaction),
                orderPosition,
                lineInFile: transaction.line ?? 0
            });
        }
    }

    ordered.sort((a, b) => {
        const dateCompare = a.effectiveDate.localeCompare(b.effectiveDate);
        if (dateCompare !== 0) return dateCompare;

        const positionCompare = a.orderPosition - b.orderPosition;
        if (positionCompare !== 0) return positionCompare;

        return a.lineInFile - b.lineInFile;
    });

    return ordered;
}
