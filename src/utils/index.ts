/**
 * Utility functions for the hledger language server
 */

import type { URI } from 'vscode-uri';
import type { Posting, Transaction } from '../types';
const directives = ['account', 'commodity', 'payee', 'tag', 'include', 'alias', 'end', 'comment', 'decimal-mark', 'P'];
/**
 * Check if a line is a transaction header
 * Transaction headers start with a date in YYYY-MM-DD, YYYY/MM/DD, or short M/D format
 * Supports single or double digit months and days (e.g., 2024-1-5 or 2024-01-05)
 * Also supports dot separators (e.g., 2024.01.01)
 */
export function isTransactionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Full date (YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD) — no lookahead needed, unambiguous
  // Short date (M/D, M-D, M.D) — requires lookahead to avoid false positives.
  // The dot form is accepted here even though `1.5` also looks like an amount: this
  // only ever runs against a line's start, where hledger reads it as a year-less
  // date. Excluding it made such transactions vanish from the parse entirely.
  const datePattern = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?=[\s=*!(]|$))/;
  return datePattern.test(trimmed);
}

/**
 * Check if a line is a posting (indented account line)
 */
export function isPosting(line: string): boolean {
  // Postings must be indented with at least one space or tab
  return /^[ \t]+\S/.test(line);
}

/**
 * Check if a line is a comment
 */
export function isComment(line: string): boolean {
  // `;` opens a comment anywhere, including indented within a transaction, where
  // it attaches to the posting above. `#` only opens one at the very start of a
  // line: indented, it belongs to an account name — hledger reads `  #a  1` as a
  // posting to the account `#a`, and `  # looks like a comment` as an account
  // called exactly that. So this must see the raw line, not a trimmed one.
  return line.trimStart().startsWith(';') || line.startsWith('#');
}

/**
 * Check if a line is a periodic transaction header
 * Periodic transactions start with ~ followed by a period expression
 * e.g., "~ monthly", "~ every 2 months  in 2023, we will review"
 */
export function isPeriodicTransactionHeader(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('~ ');
}

/**
 * Check if a line is an auto posting header
 * Auto postings start with = followed by a query
 * e.g., "= expenses:food", "= ^assets"
 */
export function isAutoPostingHeader(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('= ');
}

/**
 * Check if a line is a directive
 */
export function isDirective(line: string): boolean {
  const trimmed = line.trim();
  // Note: '~' is handled separately as periodic transaction headers
  // Note: '=' is handled separately as auto posting headers
  return directives.some(d => {
    if (d === 'end') {
      // 'end' can be standalone or followed by a space
      return trimmed === d || trimmed.startsWith(d + ' ');
    }
    return trimmed.startsWith(d + ' ');
  });
}

/**
 * Extract account name from a posting line
 */
export function extractAccountFromPosting(line: string): string | null {
  const trimmed = line.trim();
  // Account names may contain single spaces, so the name ends only at 2+ spaces, a
  // tab, or end of line. A single space before a digit or currency symbol does NOT
  // end it: `Income:Salary:Employer 401k Match` is one account name.
  const match = trimmed.match(/^([^;\s]+(?:\s+[^;\s]+)*?)(?:\s{2,}|\t|$)/);
  return match ? match[1].trim() : null;
}

/**
 * Parse a tag from a comment
 * Tags are in the format tag:value or just tag:
 */
export function extractTags(comment: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const tagPattern = /(\w+):([^,\s]*)/g;
  let match;

  while ((match = tagPattern.exec(comment)) !== null) {
    tags[match[1]] = match[2] || '';
  }

  return tags;
}

/**
 * Get the indentation level of a line
 */
export function getIndentationLevel(line: string): number {
  const match = line.match(/^([ \t]+)/);
  return match ? match[1].length : 0;
}

/**
 * Normalize a date string to YYYY-MM-DD format for consistent comparison.
 * Handles dates with different separators and single/double digit months/days.
 *
 * hledger allows `-`, `/` or `.` as the separator, but the same one throughout, so
 * the backreference leaves a mixed-separator date untouched.
 *
 * @param dateStr Date string in various formats (YYYY-MM-DD, YYYY/MM/DD, YYYY.M.D, etc.)
 * @returns Normalized date in YYYY-MM-DD format
 */
export function normalizeDate(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/);
  if (match) {
    const year = match[1];
    const month = match[3].padStart(2, '0');
    const day = match[4].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  // If already in correct format or unparseable, return as-is
  return dateStr;
}

/**
 * Get the effective date for a posting.
 * Returns posting date if present, otherwise transaction date.
 * Always returns normalized YYYY-MM-DD format for consistent comparison.
 *
 * @param posting The posting
 * @param transaction The parent transaction
 * @returns Effective date in YYYY-MM-DD format
 */
export function getEffectiveDate(posting: Posting, transaction: Transaction): string {
  const date = posting.date || transaction.date;
  return normalizeDate(date);
}

/**
 * Check if an entity originated from the given document URI.
 */
export function isFromDocument(entity: { sourceUri?: URI }, documentUri: string): boolean {
  return entity.sourceUri?.toString() === documentUri;
}

export function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.substring(1, t.length - 1);
  return t;
};

/**
 * Wrap a commodity symbol in quotes when hledger requires it.
 *
 * hledger only accepts a bare symbol when it has no digits, whitespace or
 * sign characters; symbols like B3 tickers (WEGE3, TAEE11) must be written
 * as "WEGE3" or they are read as part of the number. Symbols are stored
 * unquoted internally (see stripQuotes), so quoting happens on output.
 *
 * A symbol containing a double quote cannot be written at all (hledger has no
 * escape for it), so it is returned unchanged rather than wrapped into
 * something unparseable; the round-trip guard then refuses to format it.
 */
export function quoteCommodityIfNeeded(symbol: string): string {
  if (!symbol) return symbol;
  if (symbol.length >= 2 && symbol.startsWith('"') && symbol.endsWith('"') && !symbol.slice(1, -1).includes('"')) return symbol;
  if (symbol.includes('"')) return symbol;
  return /[\d\s+-]/.test(symbol) ? `"${symbol}"` : symbol;
}
