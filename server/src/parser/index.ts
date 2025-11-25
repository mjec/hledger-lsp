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
    const accounts = new Map<string, Account>();
    const payees = new Map<string, Payee>();
    const commodities = new Map<string, Commodity>();
    const tags = new Map<string, Tag>();

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines and comments (but process tags from comments)
      if (!line.trim()) {
        i++;
        continue;
      }

      if (isComment(line)) {
        // Extract tags from comment lines
        const commentText = line.trim().substring(1);
        const extractedTags = extractTags(commentText);
        for (const tagName of Object.keys(extractedTags)) {
          ast.addTag(tags, tagName, false, document.uri, i);
        }
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

          // Process the directive to extract metadata
          const trimmed = line.trim();
          if (trimmed.startsWith('account ')) {
            ast.processAccountDirective(line, accounts, document.uri, i);
          } else if (trimmed.startsWith('payee ')) {
            ast.processPayeeDirective(line, payees, document.uri, i);
          } else if (trimmed.startsWith('commodity ')) {
            // Commodity directives can be multi-line, so we need to handle that
            const lastLine = ast.processCommodityDirective(lines, i, commodities, document.uri);
            i = lastLine; // Skip past any subdirectives we processed
          } else if (trimmed.startsWith('tag ')) {
            ast.processTagDirective(line, tags, document.uri, i);
          }
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

          // Extract metadata from the transaction
          // Add payee
          if (transaction.payee) {
            ast.addPayee(payees, transaction.payee, false, document.uri, i);
          }

          // Extract accounts, commodities, and tags from postings
          ast.processTransaction(transaction, accounts, commodities, tags, document.uri);
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
