/**
 * Selection range provider for hledger journal files
 *
 * Provides smart text selection expansion:
 * - Account name -> Posting -> Transaction
 * - Amount -> Posting -> Transaction
 * - Description -> Transaction header -> Transaction
 */

import { SelectionRange, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isTransactionHeader, isPosting } from '../utils/index';

export class SelectionRangeProvider {
  /**
   * Provide selection ranges for a position
   */
  provideSelectionRanges(document: TextDocument, positions: Position[]): SelectionRange[] | null {
    if (positions.length === 0) {
      return null;
    }

    const selectionRanges: SelectionRange[] = [];

    for (const position of positions) {
      const range = this.getSelectionRangeAtPosition(document, position);
      if (range) {
        selectionRanges.push(range);
      }
    }

    return selectionRanges.length > 0 ? selectionRanges : null;
  }

  /**
   * Get selection range hierarchy at a specific position
   */
  private getSelectionRangeAtPosition(
    document: TextDocument,
    position: Position,
  ): SelectionRange | null {
    const lines = document.getText().split('\n');
    const currentLine = lines[position.line];
    if (!currentLine) return null;

    const trimmed = currentLine.trim();

    // Check if we're on a transaction header
    if (isTransactionHeader(trimmed)) {
      return this.getTransactionHeaderSelectionRange(currentLine, position, lines, position.line);
    }

    // Check if we're on a posting
    if (isPosting(currentLine)) {
      return this.getPostingSelectionRange(currentLine, position, lines, position.line);
    }

    // For other lines (comments, directives), just select the whole line
    return {
      range: {
        start: { line: position.line, character: 0 },
        end: { line: position.line, character: currentLine.length }
      }
    };
  }

  /**
   * Get selection range hierarchy for a transaction header
   */
  private getTransactionHeaderSelectionRange(
    line: string,
    position: Position,
    lines: string[],
    lineIndex: number,
  ): SelectionRange | null {
    // Find the word/token at the cursor position
    const wordRange = this.getWordRangeAtPosition(line, position.character);
    if (!wordRange) return null;

    // Level 1: Current word (date, status, description part, etc.)
    const wordSelection: SelectionRange = {
      range: {
        start: { line: position.line, character: wordRange.start },
        end: { line: position.line, character: wordRange.end }
      }
    };

    // Level 2: Entire transaction header line
    const headerSelection: SelectionRange = {
      range: {
        start: { line: position.line, character: 0 },
        end: { line: position.line, character: line.length }
      },
      parent: undefined
    };
    wordSelection.parent = headerSelection;

    // Level 3: Entire transaction (including postings)
    const transactionRange = this.findTransactionRange(lineIndex, lines);
    if (transactionRange) {
      const transactionSelection: SelectionRange = {
        range: {
          start: { line: transactionRange.start, character: 0 },
          end: { line: transactionRange.end, character: lines[transactionRange.end]?.length || 0 }
        }
      };
      headerSelection.parent = transactionSelection;
    }

    return wordSelection;
  }

  /**
   * Get selection range hierarchy for a posting
   */
  private getPostingSelectionRange(
    line: string,
    position: Position,
    lines: string[],
    lineIndex: number,
  ): SelectionRange | null {
    // Find the word/token at the cursor position
    const wordRange = this.getWordRangeAtPosition(line, position.character);
    if (!wordRange) return null;

    // Level 1: Current word (account name part, amount, commodity, etc.)
    const wordSelection: SelectionRange = {
      range: {
        start: { line: position.line, character: wordRange.start },
        end: { line: position.line, character: wordRange.end }
      }
    };

    // Level 2: Full account name if cursor is in account
    const accountRange = this.getAccountRangeInPosting(line);
    if (accountRange && position.character >= accountRange.start && position.character <= accountRange.end) {
      const accountSelection: SelectionRange = {
        range: {
          start: { line: position.line, character: accountRange.start },
          end: { line: position.line, character: accountRange.end }
        },
        parent: undefined
      };
      wordSelection.parent = accountSelection;

      // Level 3: Entire posting line
      const postingSelection: SelectionRange = {
        range: {
          start: { line: position.line, character: 0 },
          end: { line: position.line, character: line.length }
        }
      };
      accountSelection.parent = postingSelection;

      // Level 4: Entire transaction
      const transactionRange = this.findTransactionRangeFromPosting(lineIndex, lines);
      if (transactionRange) {
        const transactionSelection: SelectionRange = {
          range: {
            start: { line: transactionRange.start, character: 0 },
            end: { line: transactionRange.end, character: lines[transactionRange.end]?.length || 0 }
          }
        };
        postingSelection.parent = transactionSelection;
      }

      return wordSelection;
    }

    // If not in account, just do word -> posting line -> transaction
    const postingSelection: SelectionRange = {
      range: {
        start: { line: position.line, character: 0 },
        end: { line: position.line, character: line.length }
      }
    };
    wordSelection.parent = postingSelection;

    const transactionRange = this.findTransactionRangeFromPosting(lineIndex, lines);
    if (transactionRange) {
      const transactionSelection: SelectionRange = {
        range: {
          start: { line: transactionRange.start, character: 0 },
          end: { line: transactionRange.end, character: lines[transactionRange.end]?.length || 0 }
        }
      };
      postingSelection.parent = transactionSelection;
    }

    return wordSelection;
  }

  /**
   * Get the range of the word at a specific character position
   */
  private getWordRangeAtPosition(line: string, character: number): { start: number; end: number } | null {
    if (character < 0 || character > line.length) return null;

    // If at whitespace, find next non-whitespace
    while (character < line.length && /\s/.test(line[character])) {
      character++;
    }

    if (character >= line.length) return null;

    // Find word boundaries
    let start = character;
    let end = character;

    // Move start backwards to find word start
    while (start > 0 && /[^\s:;#]/.test(line[start - 1])) {
      start--;
    }

    // Move end forwards to find word end
    while (end < line.length && /[^\s:;#]/.test(line[end])) {
      end++;
    }

    if (start === end) return null;

    return { start, end };
  }

  /**
   * Get the range of the account name in a posting line
   */
  private getAccountRangeInPosting(line: string): { start: number; end: number } | null {
    // Find first non-whitespace (start of account)
    let start = 0;
    while (start < line.length && /\s/.test(line[start])) {
      start++;
    }

    // Find end of account (two or more spaces, tab, or amount/comment)
    let end = start;
    let consecutiveSpaces = 0;

    while (end < line.length) {
      const char = line[end];

      if (char === ' ') {
        consecutiveSpaces++;
        // Two consecutive spaces mark end of account
        if (consecutiveSpaces >= 2) {
          end -= consecutiveSpaces; // Back up to before the spaces
          break;
        }
      } else if (char === '\t' || char === ';' || char === '#') {
        // Tab or comment marks end of account
        break;
      } else {
        consecutiveSpaces = 0;
      }

      end++;
    }

    // Trim trailing single space if any
    while (end > start && line[end - 1] === ' ') {
      end--;
    }

    if (start === end) return null;

    return { start, end };
  }

  /**
   * Find the range of a transaction starting from its header line
   */
  private findTransactionRange(startLine: number, lines: string[]): { start: number; end: number } | null {
    let endLine = startLine;

    // Find where the transaction ends
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Empty line marks end of transaction
      if (!trimmed) {
        break;
      }

      // If it's a posting or comment, extend the range
      if (isPosting(line) || trimmed.startsWith(';') || trimmed.startsWith('#')) {
        endLine = i;
      } else if (isTransactionHeader(trimmed)) {
        // Hit the next transaction, stop here
        break;
      }
    }

    return { start: startLine, end: endLine };
  }

  /**
   * Find the range of a transaction starting from one of its posting lines
   */
  private findTransactionRangeFromPosting(postingLine: number, lines: string[]): { start: number; end: number } | null {
    // Find the transaction header by going backwards
    let headerLine = postingLine;
    for (let i = postingLine - 1; i >= 0; i--) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        // Hit empty line before finding header
        break;
      }

      if (isTransactionHeader(trimmed)) {
        headerLine = i;
        break;
      }
    }

    // Now find the end from the header
    return this.findTransactionRange(headerLine, lines);
  }
}

export const selectionRangeProvider = new SelectionRangeProvider();
