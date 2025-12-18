/**
 * Folding ranges provider for hledger journal files
 *
 * Allows collapsing:
 * - Transactions (collapse all postings)
 * - Multi-line comment blocks
 */

import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { ParsedDocument } from '../types';
import { isTransactionHeader, isPosting, isComment } from '../utils/index';


export class FoldingRangesProvider {
  /**
   * Provide folding ranges for a document
   */
  provideFoldingRanges(document: TextDocument, parsedDoc: ParsedDocument): FoldingRange[] {
    const foldingRanges: FoldingRange[] = [];
    const lines = document.getText().split('\n');

    // Add folding ranges for transactions
    foldingRanges.push(...this.getTransactionFoldingRanges(document, lines, parsedDoc));

    // Add folding ranges for comment blocks
    foldingRanges.push(...this.getCommentFoldingRanges(lines));

    return foldingRanges;
  }

  /**
   * Get folding ranges for transactions
   * Transactions can be folded to hide their postings
   */
  private getTransactionFoldingRanges(document: TextDocument, lines: string[], parsedDoc: ParsedDocument): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

    for (const transaction of parsedDoc.transactions) {
      if (transaction.line === undefined) continue;

      // Only fold transactions from the current document (skip if from workspace parsing)
      if (transaction.sourceUri?.toString() !== documentUri) {
        continue;
      }

      // Find the last posting line for this transaction
      const startLine = transaction.line;
      let endLine = startLine;

      // Find where the transaction ends (last posting or comment)
      let foundPostings = false;
      for (let i = startLine + 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Empty line marks end of transaction
        if (!trimmed) {
          break;
        }

        // If it's a posting or transaction-level comment, extend the range
        if (isPosting(line) || (trimmed.startsWith(';') || trimmed.startsWith('#'))) {
          endLine = i;
          foundPostings = true;
        } else if (isTransactionHeader(trimmed)) {
          // Hit the next transaction, stop here
          break;
        }
      }

      // Only create folding range if there are postings to fold
      if (foundPostings && endLine > startLine) {
        ranges.push({
          startLine: startLine,
          endLine: endLine,
          kind: FoldingRangeKind.Region
        });
      }
    }

    return ranges;
  }

  /**
   * Get folding ranges for multi-line comment blocks
   */
  private getCommentFoldingRanges(lines: string[]): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    let commentBlockStart: number | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (isComment(trimmed)) {
        // Start a new comment block if not already in one
        if (commentBlockStart === null) {
          commentBlockStart = i;
        }
      } else {
        // End the comment block if we were in one
        if (commentBlockStart !== null) {
          // Only create folding range if block has multiple lines
          if (i - commentBlockStart > 1) {
            ranges.push({
              startLine: commentBlockStart,
              endLine: i - 1,
              kind: FoldingRangeKind.Comment
            });
          }
          commentBlockStart = null;
        }
      }
    }

    // Handle comment block that extends to end of file
    if (commentBlockStart !== null && lines.length - commentBlockStart > 1) {
      ranges.push({
        startLine: commentBlockStart,
        endLine: lines.length - 1,
        kind: FoldingRangeKind.Comment
      });
    }

    return ranges;
  }
}

export const foldingRangesProvider = new FoldingRangesProvider();
