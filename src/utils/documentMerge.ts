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
  const transactions = [...base.transactions, ...included.transactions];
  const periodicTransactions = [...base.periodicTransactions, ...included.periodicTransactions];
  const autoPostings = [...base.autoPostings, ...included.autoPostings];
  const priceDirectives = [...base.priceDirectives, ...included.priceDirectives];
  const directives = [...base.directives, ...included.directives];

  const accountMap = new Map<string, Account>(base.accounts);
  for (const [name, a] of included.accounts) {
    const existing = accountMap.get(name);
    if (existing) {
      accountMap.set(name, { ...existing, declared: existing.declared || a.declared });
    } else {
      accountMap.set(name, a);
    }
  }

  const payeeMap = new Map<string, Payee>(base.payees);
  for (const [name, p] of included.payees) {
    const existing = payeeMap.get(name);
    if (existing) {
      payeeMap.set(name, { ...existing, declared: existing.declared || p.declared });
    } else {
      payeeMap.set(name, p);
    }
  }

  const commodityMap = new Map<string, Commodity>(base.commodities);
  for (const [name, c] of included.commodities) {
    const existing = commodityMap.get(name);
    if (existing) {
      commodityMap.set(name, { ...existing, declared: existing.declared || c.declared });
    } else {
      commodityMap.set(name, c);
    }
  }

  const tagMap = new Map<string, Tag>(base.tags);
  for (const [name, t] of included.tags) {
    const existing = tagMap.get(name);
    if (existing) {
      tagMap.set(name, { ...existing, declared: existing.declared || t.declared });
    } else {
      tagMap.set(name, t);
    }
  }

  return {
    transactions,
    periodicTransactions,
    autoPostings,
    priceDirectives,
    accounts: accountMap,
    directives,
    commodities: commodityMap,
    payees: payeeMap,
    tags: tagMap
  };
}
