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

import { ParsedDocument, Transaction, Account, Directive, Payee, Commodity, Tag, PeriodicTransaction, AutoPosting, PriceDirective } from '../types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { extractTags, isTransactionHeader, isComment, isDirective, isPeriodicTransactionHeader, isAutoPostingHeader } from '../utils/index';
import * as ast from './ast';
import { URI } from 'vscode-uri';
import { logger } from '../utils/logger';

const parserLog = logger.withContext('Parser');

export class HledgerParser {

  private scanBlockLines(lines: string[], startIndex: number): number {
    let i = startIndex;

    // Skip past the transaction lines to find where it ends
    i++;
    while (i < lines.length) {
      const nextLine = lines[i];

      // Transaction ends at empty line, next transaction, periodic/auto header, or directive
      if (!nextLine.trim() || isTransactionHeader(nextLine) || isPeriodicTransactionHeader(nextLine) || isAutoPostingHeader(nextLine) || isDirective(nextLine)) {
        break;
      }

      //Transaction ends at non indented comment line
      if (isComment(nextLine) && !nextLine.startsWith("  ")) {
        break;
      }

      i++;
    }

    const endLine = i;
    return endLine

  }

  /**
   * Parse a complete hledger document
   */
  parse(document: TextDocument): ParsedDocument {
    const text = document.getText();
    const uri: URI = URI.parse(document.uri);
    const lines = text.split('\n');

    const transactions: Transaction[] = [];
    const periodicTransactions: PeriodicTransaction[] = [];
    const autoPostings: AutoPosting[] = [];
    const priceDirectives: PriceDirective[] = [];
    const directives: Directive[] = [];
    const accounts = new Map<string, Account>();
    const payees = new Map<string, Payee>();
    const commodities = new Map<string, Commodity>();
    // `Y 2010` sets the year for year-less dates in the entries that follow it, and a
    // later Y replaces it. Tracked while scanning because it is positional.
    let defaultYear: string | undefined;
    const tags = new Map<string, Tag>();

    let i = 0;
    let inCommentBlock = false;
    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Handle comment/end comment block directives
      if (inCommentBlock) {
        if (trimmedLine === 'end comment') {
          inCommentBlock = false;
        }
        i++;
        continue;
      }
      if (trimmedLine === 'comment') {
        inCommentBlock = true;
        i++;
        continue;
      }

      // Skip empty lines and comments (but process tags from comments)
      if (!trimmedLine) {
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

      // Parse periodic transaction
      if (isPeriodicTransactionHeader(line)) {
        const startLine = i;
        i = this.scanBlockLines(lines, startLine);
        const endLine = i;
        const blockLines = lines.slice(startLine, endLine);
        const periodicTx = ast.parsePeriodicTransaction(blockLines, startLine, commodities);
        if (periodicTx) {
          periodicTx.sourceUri = uri;
          periodicTransactions.push(periodicTx);
          // Extract entities from postings
          ast.processPostings(periodicTx.postings, accounts, commodities, tags, uri);
          // Extract tags from periodic transaction level
          if (periodicTx.tags) {
            for (const tagName of Object.keys(periodicTx.tags)) {
              ast.addTag(tags, tagName, false, uri, startLine);
            }
          }
        }
        continue;
      }

      // Parse auto posting
      if (isAutoPostingHeader(line)) {
        const startLine = i;
        i = this.scanBlockLines(lines, startLine);
        const endLine = i;
        const blockLines = lines.slice(startLine, endLine);
        const autoPost = ast.parseAutoPosting(blockLines, startLine, commodities);
        if (autoPost) {
          autoPost.sourceUri = uri;
          autoPostings.push(autoPost);
          // Extract entities from auto posting entries
          ast.processAutoPostingEntries(autoPost.postings, accounts, commodities, tags, uri);
          // Extract tags from auto posting level
          if (autoPost.tags) {
            for (const tagName of Object.keys(autoPost.tags)) {
              ast.addTag(tags, tagName, false, uri, startLine);
            }
          }
        }
        continue;
      }

      // Parse price directive (before generic directive handling)
      if (isDirective(line) && trimmedLine.startsWith('P ')) {
        ast.processPriceDirective(line, priceDirectives, commodities, uri, i);
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
          if (directive.type === "account") {
            ast.processAccountDirective(line, accounts, uri, i);
          } else if (directive.type === "payee") {
            ast.processPayeeDirective(line, payees, uri, i);
          } else if (directive.type === "commodity") {
            // Commodity directives can be multi-line, so we need to handle that
            const lastLine = ast.processCommodityDirective(lines, i, commodities, uri);
            i = lastLine; // Skip past any subdirectives we processed
          } else if (directive.type === "tag") {
            ast.processTagDirective(line, tags, uri, i);
          }
        }
        i++;
        continue;
      }

      // `Y YYYY` sets the default year for year-less dates that follow. It is not in
      // the directive list (it takes no name and has no subdirectives), so it is
      // matched here, at the start of a line as hledger requires.
      const yearDirective = line.match(/^Y\s+(\d{4})\s*(?:;.*)?$/);
      if (yearDirective) {
        defaultYear = yearDirective[1];
        i++;
        continue;
      }

      // Parse transaction
      if (isTransactionHeader(line)) {

        const startLine = i;
        i = this.scanBlockLines(lines, startLine);
        const endLine = i;
        const transactionLines = lines.slice(startLine, endLine);

        const transaction = ast.parseTransaction(transactionLines, startLine, commodities, defaultYear);
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

      // Unknown line type — log at debug level so we can diagnose parse gaps
      parserLog.debug(`unrecognised line ${i} in ${uri}: ${line.slice(0, 120)}`);
      i++;
    }

    return {
      transactions,
      periodicTransactions,
      autoPostings,
      priceDirectives,
      accounts,
      directives,
      commodities,
      payees,
      tags,
    };
  }
}
