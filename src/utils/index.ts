/**
 * Utility functions for the hledger language server
 */

import type { Posting, Transaction } from '../types';

/**
 * Check if a line is a transaction header
 * Transaction headers start with a date in YYYY-MM-DD or YYYY/MM/DD format
 * Supports single or double digit months and days (e.g., 2024-1-5 or 2024-01-05)
 */
export function isTransactionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Regex for date patterns with 1 or 2 digit months and days
  const datePattern = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
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
  const trimmed = line.trim();
  return trimmed.startsWith(';') || trimmed.startsWith('#');
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
 * Check if a line is a directive
 */
export function isDirective(line: string): boolean {
  const trimmed = line.trim();
  // Note: '~' is handled separately as periodic transaction headers
  const directives = ['account', 'commodity', 'payee', 'tag', 'include', 'alias', 'end', 'comment', 'decimal-mark', '=', 'P'];
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
  // Account name is the first token after indentation
  // Must be followed by 2+ spaces, a tab, or end of line (possibly with currency/amount)
  const match = trimmed.match(/^([^;\s]+(?:\s+[^;\s]+)*?)(?:\s{2,}|\t|\s+\$|\s+[0-9-]|$)/);
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
 * @param dateStr Date string in various formats (YYYY-MM-DD, YYYY/MM/DD, YYYY/M/D, etc.)
 * @returns Normalized date in YYYY-MM-DD format
 */
export function normalizeDate(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/);
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

export const stripQuotes = (s: string) => { const t = s.trim(); if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.substring(1, t.length - 1); return t; };
