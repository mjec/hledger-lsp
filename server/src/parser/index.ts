/**
 * Parser for hledger journal files
 *
 * This module will handle parsing of hledger journal syntax including:
 * - Transactions and postings
 * - Account directives
 * - Commodity directives
 * - Comments and tags
 * - Include directives
 */

import { ParsedDocument, Transaction, Account, Directive, Posting, Amount, Payee, Commodity, Tag } from '../types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isPosting, extractAccountFromPosting, extractTags, isTransactionHeader, isComment, isDirective } from '../utils/index';
import { resolveIncludePath as resolveIncludePathUtil, resolveIncludePaths } from '../utils/uri';
import * as ast from './ast';
import { includeManager } from './includes';

/**
 * Function type for reading file contents
 * Returns TextDocument if file exists and is readable, null otherwise
 */
export type FileReader = (uri: string) => TextDocument | null;

/**
 * Options for parsing hledger documents
 */
export interface ParseOptions {
  /**
   * Base URI for resolving relative include paths
   * Should be the URI of the document being parsed
   */
  baseUri?: string;

  /**
   * Function to read file contents by URI
   * Required if followIncludes is true
   */
  fileReader?: FileReader;

  /**
   * Set of URIs already visited (for circular include detection)
   * Internal use only
   */
  visited?: Set<string>;
}

export class HledgerParser {

  /**
   * Clear the include cache
   * Should be called when included files change
   */
  clearCache(uri?: string): void {
    // Delegate cache clearing to includeManager
    includeManager.clearCache(uri);
  }

  /**
   * Parse a complete hledger document
   */
  parse(document: TextDocument, options?: ParseOptions): ParsedDocument {
    const text = document.getText();
    const lines = text.split('\n');

    const transactions: Transaction[] = [];
    const directives: Directive[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines and comments
      if (!line.trim() || isComment(line)) {
        i++;
        continue;
      }

      // Parse directive
      if (isDirective(line)) {
        const directive = ast.parseDirective(line);
        if (directive) {
          directive.sourceUri = document.uri;
          directive.line = i;
          directives.push(directive);
        }
        i++;
        continue;
      }

      // Parse transaction
      if (isTransactionHeader(line)) {
        const transaction = ast.parseTransaction(lines, i);
        if (transaction) {
          transaction.sourceUri = document.uri;
          transactions.push(transaction);
        }

        // Skip past the transaction lines to find where it ends
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];

          // Transaction ends at empty line, next transaction, or directive
          if (!nextLine.trim() || isTransactionHeader(nextLine) || isDirective(nextLine)) {
            break;
          }

          i++;
        }
        continue;
      }

      // Unknown line type, skip
      i++;
    }

    // Extract metadata using extracted AST helpers with source tracking
    const accounts = ast.extractAccounts(document, document.uri);
    const payees = ast.extractPayees(document, document.uri);
    const commodities = ast.extractCommodities(document, document.uri);
    const tags = ast.extractTagNames(document, document.uri);

    let result: ParsedDocument = {
      transactions,
      accounts,
      directives,
      commodities,
      payees,
      tags,
    };

    // Process includes (delegate to includeManager which owns the cache).
    if (options?.fileReader) {
      // For deterministic behavior in tests, clear the include cache at the start of a
      // top-level parse (when no visited set was provided). This ensures each call to
      // parser.parse(...) gets a fresh cache while still allowing caching for repeated
      // includes within the same parse invocation.
      if (!options.visited) includeManager.clearCache();

      result = includeManager.processIncludes(result, document.uri, { fileReader: options.fileReader, visited: options.visited }, (doc, cbOptions) => {
        // parseCallback: call back into this parser to parse included documents, preserving options
        return this.parse(doc, { ...options, ...cbOptions });
      });
    }

    return result;
  }

  /**
   * Validate transaction balance
   */
  validateBalance(transaction: Transaction): boolean {
    // TODO: Implement balance validation
    return true;
  }
}

export const parser = new HledgerParser();
