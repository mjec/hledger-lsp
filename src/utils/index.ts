/**
 * Utility functions for the hledger language server
 */

/**
 * Check if a line is a transaction header
 * Transaction headers start with a date in YYYY-MM-DD or YYYY/MM/DD format
 */
export function isTransactionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Simple regex for date patterns
  const datePattern = /^\d{4}[-/]\d{2}[-/]\d{2}/;
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
 * Check if a line is a directive
 */
export function isDirective(line: string): boolean {
  const trimmed = line.trim();
  const directives = ['account', 'commodity', 'payee', 'tag', 'include', 'alias', 'end', 'comment', 'decimal-mark', '~', '=', 'P'];
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
 * Normalize account name (collapse multiple spaces)
 */
export function normalizeAccountName(account: string): string {
  return account.replace(/\s+/g, ' ').trim();
}
