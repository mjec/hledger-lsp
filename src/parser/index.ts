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

import { ParsedDocument, Transaction, Account, Directive, Posting, Amount, Payee, Commodity, Tag, FileReader } from '../types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { extractTags, isTransactionHeader, isComment, isDirective } from '../utils/index';
import * as ast from './ast';
import { IncludeManager } from './includes';
import { URI } from 'vscode-uri';

/**
 * Options for parsing hledger documents
 */
export interface ParseOptions {
  /**
   * Base URI for resolving relative include paths
   * Should be the URI of the document being parsed
   */
  baseUri?: URI;

  /**
   * Function to read file contents by URI
   * Required if followIncludes is true
   */
  fileReader?: FileReader;

  /**
   * Set of URI strings already visited (for circular include detection)
   * Internal use only
   */
  visited?: Map<string, URI>;

  /**
   * Parse mode: 'document' or 'workspace'
   * - 'document': Standard include-based parsing from the current file
   * - 'workspace': Parse from workspace root for global state
   * This option is primarily used by the server's parseDocument helper
   */
  parseMode?: 'document' | 'workspace';
}

export class HledgerParser {
  private includeManager = new IncludeManager();

  /**
   * Clear the include cache
   * Should be called when included files change
   */
  clearCache(uri?: URI): void {
    // Delegate cache clearing to includeManager
    this.includeManager.clearCache(uri);
  }

  /**
   * Parse a complete hledger document
   */
  parse(document: TextDocument, options?: ParseOptions): ParsedDocument {
    const text = document.getText();
    const uri: URI = URI.parse(document.uri);
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
          ast.addTag(tags, tagName, false, uri, i);
        }
        i++;
        continue;
      }

      // Parse directive
      if (isDirective(line)) {
        const directive = ast.parseDirective(line);
        if (directive) {
          directive.sourceUri = uri;
          directive.line = i;
          directives.push(directive);

          // Process the directive to extract metadata
          const trimmed = line.trim();
          if (trimmed.startsWith('account ')) {
            ast.processAccountDirective(line, accounts, uri, i);
          } else if (trimmed.startsWith('payee ')) {
            ast.processPayeeDirective(line, payees, uri, i);
          } else if (trimmed.startsWith('commodity ')) {
            // Commodity directives can be multi-line, so we need to handle that
            const lastLine = ast.processCommodityDirective(lines, i, commodities, uri);
            i = lastLine; // Skip past any subdirectives we processed
          } else if (trimmed.startsWith('tag ')) {
            ast.processTagDirective(line, tags, uri, i);
          }
        }
        i++;
        continue;
      }

      // Parse transaction
      if (isTransactionHeader(line)) {
        const transaction = ast.parseTransaction(lines, i);
        if (transaction) {
          transaction.sourceUri = uri;
          transactions.push(transaction);

          // Extract metadata from the transaction
          // Add payee
          if (transaction.payee) {
            ast.addPayee(payees, transaction.payee, false, uri, i);
          }

          // Extract accounts, commodities, and tags from postings
          ast.processTransaction(transaction, accounts, commodities, tags, uri);
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
    if (options?.fileReader && options.parseMode != 'document') {
      result = this.includeManager.processIncludes(result, uri, { fileReader: options.fileReader, visited: options.visited }, (doc, cbOptions) => {
        // parseCallback: call back into this parser to parse included documents, preserving options
        return this.parse(doc, { ...options, ...cbOptions });
      });
    }

    return result;
  }
}
