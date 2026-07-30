import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../../src/parser';
import { Validator } from '../../src/features/validator';
import { formattingProvider } from '../../src/features/formatter';
import { defaultSettings } from '../../src/server/settings';
import { normalizeDate } from '../../src/utils/index';
import { HledgerPrintTransaction } from '../integration/hledger-conformance/hledgerRunner';
import { isKnown } from './knownDivergences';

/**
 * Compare the LSP's reading of a journal against hledger's.
 *
 * Verdict parity alone is not enough: the `Y` directive bug and the vanishing
 * dot-date transaction both had hledger and the LSP agreeing the journal was valid
 * while the parsed model was wrong. So the transaction count, resolved dates and
 * posting amounts are compared too.
 */

/** Amounts are compared numerically; formatting and float noise are not the point. */
const TOLERANCE = 1e-6;

function checksMirroringHledger(): typeof defaultSettings.validation {
    // hledger's default checks are parseable, autobalanced and assertions. Anything
    // stylistic (undeclared accounts, missing descriptions) would fire on perfectly
    // good journals and say nothing about conformance.
    return {
        ...defaultSettings.validation,
        undeclaredAccounts: false,
        undeclaredPayees: false,
        undeclaredCommodities: false,
        undeclaredTags: false,
        emptyDescriptions: false,
        dateOrdering: false,
        futureDates: false,
        formatMismatch: false,
        requireExplicitCosts: false,
    };
}

/** Total quantity per commodity across a posting's amounts. */
function amountsByCommodity(amounts: { commodity: string; quantity: number }[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const { commodity, quantity } of amounts) {
        totals.set(commodity, (totals.get(commodity) ?? 0) + quantity);
    }
    return totals;
}

function describeAmounts(totals: Map<string, number>): string {
    return [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([commodity, quantity]) => `${quantity} ${commodity || '(none)'}`)
        .join(', ') || '(nothing)';
}

/**
 * Describe every way the LSP's reading differs from hledger's. An empty result means
 * they agree.
 */
export function findDivergences(
    journal: string,
    filePath: string,
    hledgerTransactions: HledgerPrintTransaction[]
): string[] {
    const divergences: string[] = [];

    const doc = TextDocument.create(URI.file(filePath).toString(), 'hledger', 1, journal);
    const parsed = new HledgerParser().parse(doc);
    const result = new Validator().validate(doc, parsed, {
        settings: { validation: checksMirroringHledger() },
    });

    // hledger accepted this journal, so any error diagnostic is a false positive.
    for (const diagnostic of result.diagnostics.filter(d => d.severity === 1)) {
        divergences.push(`unexpected error: ${diagnostic.message}`);
    }

    if (parsed.transactions.length !== hledgerTransactions.length) {
        divergences.push(
            `transaction count: hledger ${hledgerTransactions.length}, LSP ${parsed.transactions.length}`
        );
        // Comparing entry by entry past this point would only produce noise.
        return divergences.filter(d => !isKnown(d));
    }

    // hledger's `print` output is ordered by date; ours follows the file. Compare in a
    // stable order so the pairing is meaningful.
    const ours = [...parsed.transactions].sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));
    const theirs = [...hledgerTransactions].sort((a, b) => a.date.localeCompare(b.date));

    ours.forEach((transaction, i) => {
        const expected = theirs[i];
        const where = `transaction ${i + 1} (${expected.date})`;

        if (normalizeDate(transaction.date) !== expected.date) {
            divergences.push(`${where} date: hledger ${expected.date}, LSP ${normalizeDate(transaction.date)}`);
        }

        if (transaction.postings.length !== expected.postings.length) {
            divergences.push(
                `${where} posting count: hledger ${expected.postings.length}, LSP ${transaction.postings.length}`
            );
            return;
        }

        transaction.postings.forEach((posting, j) => {
            const expectedPosting = expected.postings[j];

            if (posting.account !== expectedPosting.account) {
                divergences.push(
                    `${where} posting ${j + 1} account: hledger "${expectedPosting.account}", LSP "${posting.account}"`
                );
            }

            const expectedTotals = amountsByCommodity(expectedPosting.amounts);
            const ourTotals = amountsByCommodity(posting.amount ? [posting.amount] : []);

            // hledger can hold several commodities on one posting; we hold one. Only
            // flag a difference when the commodities we do report disagree, so the
            // known model limitation does not drown out real findings.
            for (const [commodity, quantity] of ourTotals) {
                const expectedQuantity = expectedTotals.get(commodity);
                if (expectedQuantity === undefined) {
                    divergences.push(
                        `${where} posting ${j + 1} commodity ${commodity || '(none)'}: hledger has none, `
                        + `LSP has ${quantity} (hledger: ${describeAmounts(expectedTotals)})`
                    );
                } else if (Math.abs(expectedQuantity - quantity) > TOLERANCE) {
                    divergences.push(
                        `${where} posting ${j + 1} amount ${commodity || '(none)'}: `
                        + `hledger ${expectedQuantity}, LSP ${quantity}`
                    );
                }
            }

            if (ourTotals.size === 0 && expectedTotals.size > 0) {
                divergences.push(
                    `${where} posting ${j + 1} amount: hledger ${describeAmounts(expectedTotals)}, LSP none`
                );
            }
        });
    });

    return divergences.filter(d => !isKnown(d));
}

/** Format a journal the way `--format` and format-on-save do. */
export function formatJournal(journal: string, filePath: string): string {
    const doc = TextDocument.create(URI.file(filePath).toString(), 'hledger', 1, journal);
    const parsed = new HledgerParser().parse(doc);
    const edits = formattingProvider.formatDocument(doc, parsed, { tabSize: 4, insertSpaces: true });

    return edits.length === 0 ? journal : edits[0].newText;
}

/** A transaction reduced to what it means, for comparing before and after formatting. */
function meaning(transactions: HledgerPrintTransaction[]): string {
    return transactions
        .map(t => `${t.date} ${t.description}\n` + t.postings
            .map(p => `  ${p.account} ${describeAmounts(amountsByCommodity(p.amounts))}`)
            .join('\n'))
        .join('\n');
}

/**
 * Describe any way formatting changed what the journal *means*, as hledger reads it.
 *
 * Formatting adjusts layout and nothing else, so hledger must read the formatted text
 * exactly as it read the original. This property is what catches a formatter that
 * rewrites content: it expanded a year-less date into a full one using the wrong
 * year, silently changing every such date — and `--format -o` and format-on-save both
 * write the result back over the user's file.
 */
export function findFormattingDivergences(
    before: HledgerPrintTransaction[],
    after: HledgerPrintTransaction[]
): string[] {
    const meaningBefore = meaning(before);
    const meaningAfter = meaning(after);

    if (meaningBefore === meaningAfter) return [];

    return [
        'formatting changed what the journal means:\n'
        + `   before:\n${meaningBefore.replace(/^/gm, '     ')}\n`
        + `   after:\n${meaningAfter.replace(/^/gm, '     ')}`,
    ].filter(d => !isKnown(d));
}
