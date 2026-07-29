import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { ParsedDocument, Posting, Transaction } from '../../types';
import { inferAmountsForPostings, inferCosts, isBalanceAssignmentPosting } from '../../parser/ast';
import { buildIncludePositionMap, orderPostings } from './journalOrder';
import { findPostingRange } from './assertions';

/**
 * Balance assignments.
 *
 * A posting that gives a balance but no amount (`a  = $1.30`) is a *balance
 * assignment*: hledger infers the amount as the asserted balance minus the
 * account's prior balance. Because that prior balance can come from an included
 * file, and because an amount-less posting elsewhere in the same transaction may
 * still need auto-balancing afterwards, this cannot be done by the single-file
 * parser — it runs as a pre-pass over the merged workspace document.
 *
 * Semantics verified against hledger 1.52.1; see
 * docs/superpowers/specs/2026-07-29-balance-assignments-design.md.
 */

/** Running balance per account, per commodity. */
type Balances = Map<string, Map<string, number>>;

function balanceOf(balances: Balances, account: string, commodity: string): number {
    return balances.get(account)?.get(commodity) ?? 0;
}

function addToBalance(balances: Balances, account: string, commodity: string, quantity: number): void {
    let byCommodity = balances.get(account);
    if (!byCommodity) {
        byCommodity = new Map();
        balances.set(account, byCommodity);
    }
    byCommodity.set(commodity, (byCommodity.get(commodity) ?? 0) + quantity);
}

/**
 * Whether a posting's amount is already determined at the point assignments are
 * resolved.
 *
 * The parser auto-balances the lone amount-less posting of each balancing group,
 * but hledger resolves assignments *before* auto-balancing, so within the same
 * transaction such an amount does not yet exist. An amount from a *previous*
 * transaction has been determined by then, which is why this is only consulted
 * for the transaction being resolved.
 */
function hasKnownAmount(posting: Posting): boolean {
    if (!posting.amount) return false;
    return !posting.amount.inferred || posting.isBalanceAssignment === true;
}

/**
 * Resolve the assignments in one transaction, in posting order.
 *
 * An assignment sees the amounts of earlier postings in the same transaction
 * that are already known — including earlier assignments — but not those still
 * awaiting auto-balancing, which is why this runs before auto-balancing.
 */
function resolveAssignmentsInTransaction(transaction: Transaction, balances: Balances): void {
    // Amounts contributed by earlier postings of this transaction, so an
    // assignment sees them without them being committed to `balances` twice.
    const pending: Balances = new Map();

    for (const posting of transaction.postings) {
        if (isBalanceAssignmentPosting(posting)) {
            posting.isBalanceAssignment = true;

            // hledger refuses to resolve an assignment carrying a custom posting
            // date rather than choosing which balance to resolve against, so the
            // amount is left unresolved here and validateBalanceAssignmentRules
            // reports it. Inferring one anyway would make the transaction look
            // unbalanced by exactly that figure — an error hledger never reports,
            // caused solely by an inference it declined to make.
            if (!posting.date) {
                const assertion = posting.assertion!;
                const commodity = assertion.commodity || '';
                const priorBalance =
                    balanceOf(balances, posting.account, commodity) +
                    balanceOf(pending, posting.account, commodity);

                posting.amount = {
                    quantity: assertion.quantity - priorBalance,
                    commodity,
                    inferred: true
                };
            }
        }

        if (hasKnownAmount(posting)) {
            addToBalance(pending, posting.account, posting.amount!.commodity || '', posting.amount!.quantity);
        }
    }
}

/**
 * Report uses of balance assignments that hledger rejects outright.
 *
 * Must run after `resolveBalanceAssignments`, which is what marks the postings.
 */
export function validateBalanceAssignmentRules(transaction: Transaction, lines: string[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const posting of transaction.postings) {
        // hledger resolves an assignment against the account balance at that point
        // in the journal, which a custom posting date would move, so it refuses the
        // combination rather than pick an interpretation.
        if (posting.isBalanceAssignment && posting.date) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: findPostingRange(transaction, posting, lines),
                message: 'Balance assignments and custom posting dates may not be combined',
                source: 'hledger'
            });
        }
    }

    return diagnostics;
}

/**
 * Infer amounts for every balance assignment in the document, mutating the
 * postings in place. Safe to call more than once on the same document: a
 * resolved assignment has an amount, so it is no longer an assignment.
 */
export function resolveBalanceAssignments(
    parsedDoc: ParsedDocument,
    documentUri: string,
    baseUri: URI
): void {
    const balances: Balances = new Map();
    const includePositions = buildIncludePositionMap(parsedDoc, baseUri);
    const ordered = orderPostings(parsedDoc.transactions, documentUri, includePositions);
    const resolved = new Set<Transaction>();

    for (const { transaction, posting } of ordered) {
        // A transaction's assignments are all resolved together, the first time the
        // walk reaches *any* of its postings — not the first assignment. Waiting
        // for the assignment would mean earlier postings of the same transaction
        // had already been folded into `balances`, and `resolveAssignmentsInTransaction`
        // would count them a second time via `pending`.
        if (!resolved.has(transaction)) {
            resolved.add(transaction);
            if (transaction.postings.some(isBalanceAssignmentPosting)) {
                resolveAssignmentsInTransaction(transaction, balances);
                // Resolving assignments may leave exactly one amount-less posting in
                // a balancing group, which can now be auto-balanced.
                inferAmountsForPostings(transaction.postings);
                // Both of the above can complete a transaction that the parser had to
                // skip, so the inferences the parser makes from complete amounts have
                // to be retried: a two-commodity transaction gets its total cost here
                // (hledger prints `c 50 B @@ 50 A` for two assignments in different
                // commodities), without which it would look unbalanced in both.
                inferCosts(transaction);
            }
        }

        // Postings are folded in as the walk reaches them. One whose amount only
        // became known later is not counted, which is the intended reading: at
        // this point in the journal that amount did not yet exist.
        if (posting.amount) {
            addToBalance(balances, posting.account, posting.amount.commodity || '', posting.amount.quantity);
        }
    }
}
