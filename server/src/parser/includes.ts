import { ParsedDocument, Account, Payee, Commodity, Tag } from '../types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { resolveIncludePaths } from '../utils/uri';

export type FileReader = (uri: string) => TextDocument | null;

export type ParseCallback = (doc: TextDocument, options?: { followIncludes?: boolean; baseUri?: string; fileReader?: FileReader; visited?: Set<string> }) => ParsedDocument;

export class IncludeManager {
  // Own the cache for parsed included files to centralize include behavior
  private includeCache: Map<string, ParsedDocument> = new Map();

  clearCache(uri?: string) {
    if (uri) this.includeCache.delete(uri);
    else this.includeCache.clear();
  }

  mergeParsedDocuments(base: ParsedDocument, included: ParsedDocument): ParsedDocument {
    const transactions = [...base.transactions, ...included.transactions];
    const directives = [...base.directives, ...included.directives];

    const accountMap = new Map<string, Account>();
    for (const a of base.accounts) accountMap.set(a.name, a);
    for (const a of included.accounts) {
      const existing = accountMap.get(a.name);
      if (existing) accountMap.set(a.name, { ...existing, declared: existing.declared || a.declared });
      else accountMap.set(a.name, a);
    }
    const accounts = Array.from(accountMap.values()).sort((x,y) => x.name.localeCompare(y.name));

    const payeeMap = new Map<string, Payee>();
    for (const p of base.payees) payeeMap.set(p.name, p);
    for (const p of included.payees) {
      const existing = payeeMap.get(p.name);
      if (existing) payeeMap.set(p.name, { ...existing, declared: existing.declared || p.declared });
      else payeeMap.set(p.name, p);
    }
    const payees = Array.from(payeeMap.values()).sort((a,b)=>a.name.localeCompare(b.name));

    const commodityMap = new Map<string, Commodity>();
    for (const c of base.commodities) commodityMap.set(c.name, c);
    for (const c of included.commodities) {
      const existing = commodityMap.get(c.name);
      if (existing) commodityMap.set(c.name, { ...existing, declared: existing.declared || c.declared });
      else commodityMap.set(c.name, c);
    }
    const commodities = Array.from(commodityMap.values()).sort((a,b)=>a.name.localeCompare(b.name));

    const tagMap = new Map<string, Tag>();
    for (const t of base.tags) tagMap.set(t.name, t);
    for (const t of included.tags) {
      const existing = tagMap.get(t.name);
      if (existing) tagMap.set(t.name, { ...existing, declared: existing.declared || t.declared });
      else tagMap.set(t.name, t);
    }
    const tags = Array.from(tagMap.values()).sort((a,b)=>a.name.localeCompare(b.name));

    return { transactions, accounts, directives, commodities, payees, tags };
  }
  /**
   * Process include directives: resolve include paths using resolveIncludePaths, use fileReader to load
   * included documents and parseCallback to obtain their ParsedDocument form. The include cache is
   * maintained here to avoid repeated parsing.
   */
  processIncludes(
    parsed: ParsedDocument,
    baseUri: string,
    options: { fileReader?: FileReader; visited?: Set<string> },
    parseCallback: ParseCallback
  ): ParsedDocument {
    const visited = options.visited || new Set<string>();
    visited.add(baseUri);

    const merged = new Set<string>();
    let result: ParsedDocument = { ...parsed };

    for (const directive of parsed.directives) {
      if (directive.type !== 'include' || !options.fileReader) continue;
      const includePath = directive.value;
      const resolvedUris = resolveIncludePaths(includePath, baseUri);

      for (const resolvedUri of resolvedUris) {
        if (visited.has(resolvedUri)) continue;
        if (merged.has(resolvedUri)) continue;

        let includedDoc = this.includeCache.get(resolvedUri) || null;
        if (!includedDoc) {
          const includedTextDoc = options.fileReader(resolvedUri);
          if (includedTextDoc) {
            // Use the provided parseCallback to parse included file recursively
            includedDoc = parseCallback(includedTextDoc, { ...options, baseUri: resolvedUri, visited: new Set(visited) });
            // Cache parsed result
            this.includeCache.set(resolvedUri, includedDoc);
          }
        }

        if (includedDoc) {
          result = this.mergeParsedDocuments(result, includedDoc);
          merged.add(resolvedUri);
        }
      }
    }

    return result;
  }
}

export const includeManager = new IncludeManager();
