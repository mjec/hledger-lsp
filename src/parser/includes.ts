import { ParsedDocument, Account, Payee, Commodity, Tag, FileReader } from '../types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { resolveIncludePaths } from '../utils/uri';
import { URI } from 'vscode-uri';


export type ParseCallback = (doc: TextDocument, options?: { followIncludes?: boolean; baseUri?: URI; fileReader?: FileReader; visited?: Map<string, URI> }) => ParsedDocument;

export class IncludeManager {
  // Own the cache for parsed included files to centralize include behavior
  private includeCache: Map<URI, ParsedDocument> = new Map();

  clearCache(uri?: URI) {
    if (uri) this.includeCache.delete(uri);
    else this.includeCache.clear();
  }

  mergeParsedDocuments(base: ParsedDocument, included: ParsedDocument): ParsedDocument {
    const transactions = [...base.transactions, ...included.transactions];
    const directives = [...base.directives, ...included.directives];

    const accountMap = new Map<string, Account>(base.accounts);
    for (const [name, a] of included.accounts) {
      const existing = accountMap.get(name);
      if (existing) accountMap.set(name, { ...existing, declared: existing.declared || a.declared });
      else accountMap.set(name, a);
    }

    const payeeMap = new Map<string, Payee>(base.payees);
    for (const [name, p] of included.payees) {
      const existing = payeeMap.get(name);
      if (existing) payeeMap.set(name, { ...existing, declared: existing.declared || p.declared });
      else payeeMap.set(name, p);
    }

    const commodityMap = new Map<string, Commodity>(base.commodities);
    for (const [name, c] of included.commodities) {
      const existing = commodityMap.get(name);
      if (existing) commodityMap.set(name, { ...existing, declared: existing.declared || c.declared });
      else commodityMap.set(name, c);
    }

    const tagMap = new Map<string, Tag>(base.tags);
    for (const [name, t] of included.tags) {
      const existing = tagMap.get(name);
      if (existing) tagMap.set(name, { ...existing, declared: existing.declared || t.declared });
      else tagMap.set(name, t);
    }

    return { transactions, accounts: accountMap, directives, commodities: commodityMap, payees: payeeMap, tags: tagMap };
  }
  /**
   * Process include directives: resolve include paths using resolveIncludePaths, use fileReader to load
   * included documents and parseCallback to obtain their ParsedDocument form. The include cache is
   * maintained here to avoid repeated parsing.
   */
  processIncludes(
    parsed: ParsedDocument,
    baseUri: URI,
    options: { fileReader?: FileReader; visited?: Map<string, URI> },
    parseCallback: ParseCallback
  ): ParsedDocument {
    const visited = options.visited || new Map<string, URI>();
    visited.set(baseUri.toString(), baseUri);

    const merged = new Map<string, URI>();
    let result: ParsedDocument = { ...parsed };

    for (const directive of parsed.directives) {
      if (directive.type !== 'include' || !options.fileReader) continue;
      const includePath = directive.value;
      const resolvedUris = resolveIncludePaths(includePath, baseUri);

      for (const resolvedUri of resolvedUris) {
        if (visited.has(resolvedUri.toString())) continue;
        if (merged.has(resolvedUri.toString())) continue;

        let includedDoc = this.includeCache.get(resolvedUri) || null;
        if (!includedDoc) {
          const includedTextDoc = options.fileReader(resolvedUri);
          if (includedTextDoc) {
            // Use the provided parseCallback to parse included file recursively
            includedDoc = parseCallback(includedTextDoc, { ...options, baseUri: resolvedUri, visited: new Map(visited) });
            // Cache parsed result
            this.includeCache.set(resolvedUri, includedDoc);
          }
        }

        if (includedDoc) {
          result = this.mergeParsedDocuments(result, includedDoc);
          merged.set(resolvedUri.toString(), resolvedUri);
        }
      }
    }

    return result;
  }
}
