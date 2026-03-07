/**
 * Utilities for merging ParsedDocument objects.
 * Used by WorkspaceManager for graph-based merging of multi-file workspaces.
 */

import { ParsedDocument, Account, Payee, Commodity, Tag, PeriodicTransaction, AutoPosting, PriceDirective } from '../types';

/**
 * Create an empty ParsedDocument as a base for merging.
 */
export function createEmptyParsedDocument(): ParsedDocument {
  return {
    transactions: [],
    periodicTransactions: [],
    autoPostings: [],
    priceDirectives: [],
    accounts: new Map<string, Account>(),
    directives: [],
    commodities: new Map<string, Commodity>(),
    payees: new Map<string, Payee>(),
    tags: new Map<string, Tag>()
  };
}

function mergeMaps<T extends { declared: boolean }>(
  base: Map<string, T>,
  included: Map<string, T>
): Map<string, T> {
  const result = new Map<string, T>(base);
  for (const [name, item] of included) {
    const existing = result.get(name);
    if (existing) {
      result.set(name, { ...existing, declared: existing.declared || item.declared });
    } else {
      result.set(name, item);
    }
  }
  return result;
}

/**
 * Merge two ParsedDocuments together.
 * The included document's contents are added to the base document.
 * For maps (accounts, payees, commodities, tags), entries are merged with
 * declared status preserved (declared in either = declared in result).
 *
 * @param base - The base document to merge into
 * @param included - The document to merge from
 * @returns A new merged ParsedDocument
 */
export function mergeParsedDocuments(base: ParsedDocument, included: ParsedDocument): ParsedDocument {
  return {
    transactions: [...base.transactions, ...included.transactions],
    periodicTransactions: [...base.periodicTransactions, ...included.periodicTransactions],
    autoPostings: [...base.autoPostings, ...included.autoPostings],
    priceDirectives: [...base.priceDirectives, ...included.priceDirectives],
    directives: [...base.directives, ...included.directives],
    accounts: mergeMaps(base.accounts, included.accounts),
    payees: mergeMaps(base.payees, included.payees),
    commodities: mergeMaps(base.commodities, included.commodities),
    tags: mergeMaps(base.tags, included.tags),
  };
}
