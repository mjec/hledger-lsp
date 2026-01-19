/**
 * Parser for hledger journal files
 *
 * This module handles parsing of hledger journal syntax including:
 * - Transactions and postings
 * - Account directives
 * - Commodity directives
 * - Comments and tags
 * - Include directives (recording them, not following them)
 *
 * Note: Include resolution and multi-file merging is handled by WorkspaceManager,
 * not by this parser. The parser always operates in "document mode" - parsing
 * a single file without following includes.
 */

import { ParsedDocument, Transaction, Account, Directive, Payee, Commodity, Tag } from '../types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { extractTags, isTransactionHeader, isComment, isDirective } from '../utils/index';
import * as ast from './ast';
import { URI } from 'vscode-uri';

/**
 * Options for parsing hledger documents
 */
export interface ParseOptions {
  /**
   * Base URI for the document being parsed.
   * Used to set sourceUri on parsed entities.
   */
  baseUri?: URI;

  /**
   * Parse mode hint (for logging/debugging).
   * The parser always parses single documents; include resolution
   * is handled by WorkspaceManager.
   */
  parseMode?: 'document' | 'workspace';
}

export class HledgerParser {

  /**
   * Parse a complete hledger document
   */
  parse(document: TextDocument): ParsedDocument {
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
          if (directive.type == "account") {
            ast.processAccountDirective(line, accounts, uri, i);
          } else if (directive.type == "payee") {
            ast.processPayeeDirective(line, payees, uri, i);
          } else if (directive.type == "commodity") {
            // Commodity directives can be multi-line, so we need to handle that
            const lastLine = ast.processCommodityDirective(lines, i, commodities, uri);
            i = lastLine; // Skip past any subdirectives we processed
          } else if (directive.type == "tag") {
            ast.processTagDirective(line, tags, uri, i);
          }
        }
        i++;
        continue;
      }

      // Parse transaction
      if (isTransactionHeader(line)) {

        const startLine = i;

        // Skip past the transaction lines to find where it ends
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];

          // Transaction ends at empty line, next transaction, or directive
          if (!nextLine.trim() || isTransactionHeader(nextLine) || isDirective(nextLine)) {
            break;
          }

          //Transaction ends at non indented comment line
          if (isComment(nextLine) && !nextLine.startsWith("  ")) {
            break;
          }

          i++;
        }

        const endLine = i;
        const transactionLines = lines.slice(startLine, endLine);

        const transaction = ast.parseTransaction(transactionLines, startLine);
        if (transaction) {
          transaction.sourceUri = uri;
          transactions.push(transaction);

          // Extract metadata from the transaction
          // Add payee
          if (transaction.payee) {
            ast.addPayee(payees, transaction.payee, false, uri, startLine);
          }

          // Extract accounts, commodities, and tags from postings
          ast.processTransaction(transaction, accounts, commodities, tags, uri);
        }

        continue;
      }

      // Unknown line type, skip
      i++;
    }

    return {
      transactions,
      accounts,
      directives,
      commodities,
      payees,
      tags,
    };
  }
}
