/**
 * Differences from hledger that are deliberate, with the reason for each.
 *
 * The comparator ignores a divergence whose description matches one of these. Keeping
 * them in a committed file makes adding one a visible decision in review, rather than
 * a suppression that quietly widens over time.
 *
 * Nothing is listed yet: the generator only produces constructs we intend to match
 * exactly. The known model differences — hledger expanding a costed balance
 * assignment into conversion postings, and inferring two amounts for a single
 * posting — are not generated, because one `Amount` per posting cannot represent
 * them. If the generator is extended to cover them, they belong here.
 */
export interface KnownDivergence {
    /** Substring of the divergence description this excuses. */
    matches: string;
    /** Why the difference is intended. */
    reason: string;
}

export const KNOWN_DIVERGENCES: readonly KnownDivergence[] = [];

export function isKnown(description: string): boolean {
    return KNOWN_DIVERGENCES.some(known => description.includes(known.matches));
}
