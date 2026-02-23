/**
 * Wrapper for executing hledger CLI commands and parsing their output.
 * Used by conformance tests to establish ground truth for validation.
 */

import { execSync } from 'child_process';

export interface HledgerError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  checkType: string;
}

export interface HledgerResult {
  success: boolean;
  errors: HledgerError[];
  rawStderr: string;
}

/**
 * Check if hledger is available in PATH.
 */
export function isHledgerAvailable(): boolean {
  try {
    execSync('hledger --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `hledger check` against a journal file with optional check types.
 *
 * @param filePath - Absolute path to the journal file
 * @param checks - Optional array of check names (e.g., ['accounts', 'payees'])
 *                 If empty, runs the default checks (parseable, autobalanced, assertions)
 */
export function runHledgerCheck(filePath: string, checks?: string[]): HledgerResult {
  const checkArgs = checks && checks.length > 0 ? checks.join(' ') : '';
  const command = `hledger check ${checkArgs} -f "${filePath}"`.trim();

  try {
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, errors: [], rawStderr: '' };
  } catch (error: any) {
    const stderr: string = error.stderr || '';
    const errors = parseHledgerErrors(stderr, checks?.[0] || 'default');

    return {
      success: false,
      errors,
      rawStderr: stderr,
    };
  }
}

/**
 * Parse hledger's stderr output into structured error objects.
 *
 * hledger error format examples:
 *   hledger: Error: /path/to/file.j:4:
 *   hledger: Error: /path/to/file.j:4:8:
 *   hledger: Error: /path/to/file.j:3-4:
 */
function parseHledgerErrors(stderr: string, checkType: string): HledgerError[] {
  const errors: HledgerError[] = [];

  // Match the error header line: "hledger: Error: /path:line:" or "hledger: Error: /path:line:col:"
  // Also handles range format like "/path:3-4:"
  const errorHeaderPattern = /hledger: Error: ([^:\n]+):(\d+)(?:-\d+)?(?::(\d+))?:/g;

  let match;
  while ((match = errorHeaderPattern.exec(stderr)) !== null) {
    const file = match[1];
    const line = parseInt(match[2], 10);
    const column = match[3] ? parseInt(match[3], 10) : undefined;

    // Extract the message: everything after the decorated source lines until EOF or next error
    const afterHeader = stderr.substring(match.index + match[0].length);
    const message = extractErrorMessage(afterHeader);

    errors.push({
      file,
      line,
      column,
      message: message.trim(),
      checkType,
    });
  }

  // If we couldn't parse any structured errors but there was stderr, create a generic one
  if (errors.length === 0 && stderr.trim().length > 0) {
    errors.push({
      message: stderr.trim(),
      checkType,
    });
  }

  return errors;
}

/**
 * Extract the human-readable error message from hledger output,
 * skipping the source code display lines (lines starting with digits + "|" or just "|").
 */
function extractErrorMessage(text: string): string {
  const lines = text.split('\n');
  const messageLines: string[] = [];
  let inMessage = false;

  for (const line of lines) {
    // Skip empty lines at the start
    if (!inMessage && line.trim() === '') continue;

    // Skip source display lines (e.g., "4 |     (a)  1" or "  |")
    if (/^\s*\d*\s*\|/.test(line)) continue;

    // Skip caret lines (e.g., "  |      ^")
    if (/^\s*\|?\s*\^+\s*$/.test(line)) continue;

    // We've found message content
    inMessage = true;
    messageLines.push(line);
  }

  return messageLines.join('\n').trim();
}

// ─── Account discovery ──────────────────────────────────────────────

/**
 * Run `hledger accounts` and return the list of account names.
 */
export function runHledgerAccounts(filePath: string): string[] {
  const output = execSync(`hledger accounts -f "${filePath}"`, {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return output.trim().split('\n').filter(l => l.length > 0);
}

// ─── Balance ────────────────────────────────────────────────────────

export interface BalanceEntry {
  account: string;
  amounts: Map<string, number>; // commodity → quantity
}

/**
 * Run `hledger balance -O csv` and return per-account balances.
 */
export function runHledgerBalance(filePath: string): BalanceEntry[] {
  const output = execSync(`hledger balance -f "${filePath}" -O csv --no-elide`, {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  const lines = output.trim().split('\n');
  const entries: BalanceEntry[] = [];

  // Skip header row, and skip the "Total:" row at the end
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row.length < 2) continue;
    const account = row[0];
    if (account === 'Total:') continue;
    entries.push({ account, amounts: parseAmountList(row[1]) });
  }
  return entries;
}

// ─── Aregister ──────────────────────────────────────────────────────

export interface AregisterEntry {
  txnidx: number;
  date: string;
  description: string;
  change: Map<string, number>;
  balance: Map<string, number>;
}

/**
 * Run `hledger aregister <account> -O csv` and return per-transaction entries.
 */
export function runHledgerAregister(filePath: string, account: string): AregisterEntry[] {
  const output = execSync(`hledger aregister "${account}" -f "${filePath}" -O csv`, {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  const lines = output.trim().split('\n');
  const entries: AregisterEntry[] = [];

  // Skip header: "txnidx","date","code","description","otheraccounts","change","balance"
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row.length < 7) continue;
    entries.push({
      txnidx: parseInt(row[0], 10),
      date: row[1],
      description: row[3],
      change: parseAmountList(row[5]),
      balance: parseAmountList(row[6]),
    });
  }
  return entries;
}

// ─── Print (JSON) ───────────────────────────────────────────────────

export interface HledgerPrintPosting {
  account: string;
  amounts: { commodity: string; quantity: number }[];
}

export interface HledgerPrintTransaction {
  tindex: number;
  date: string;
  description: string;
  postings: HledgerPrintPosting[];
}

/**
 * Run `hledger print -O json` and return parsed transactions.
 */
export function runHledgerPrint(filePath: string): HledgerPrintTransaction[] {
  const output = execSync(`hledger print -f "${filePath}" -O json`, {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  const data = JSON.parse(output);
  return data.map((tx: any) => ({
    tindex: tx.tindex,
    date: tx.tdate,
    description: tx.tdescription,
    postings: tx.tpostings.map((p: any) => ({
      account: p.paccount,
      amounts: p.pamount.map((a: any) => ({
        commodity: a.acommodity,
        quantity: a.aquantity.floatingPoint,
      })),
    })),
  }));
}

// ─── Amount parsing helpers ─────────────────────────────────────────

/**
 * Parse a single amount string from hledger CSV output.
 * Handles formats like: "$1", "250.60 HRK", "-20 EUR", "£100", "0",
 * "-$135", "$-135", "1 AAA @ 1.20 USD"
 */
export function parseAmountString(s: string): { commodity: string; quantity: number } {
  s = s.trim();

  // Strip cost annotations (@ / @@) — we only want the primary amount
  const costIdx = s.search(/\s+@@?\s+/);
  if (costIdx !== -1) {
    s = s.substring(0, costIdx).trim();
  }

  if (s === '0') return { commodity: '', quantity: 0 };

  // Try prefix-symbol format: $100, -$100, $-100, £100, €100
  // Symbol chars: anything non-digit, non-whitespace, non-minus, non-dot, non-comma at start
  const prefixMatch = s.match(/^(-?)([^\d\s\-.,]+)(-?[\d,]*\.?\d*)$/);
  if (prefixMatch) {
    const sign = prefixMatch[1] || '';
    const commodity = prefixMatch[2];
    const numStr = sign + prefixMatch[3].replace(/,/g, '');
    return { commodity, quantity: parseFloat(numStr) };
  }

  // Try suffix-symbol format: "100 USD", "-20 EUR", "1 AAA"
  const suffixMatch = s.match(/^(-?[\d,]*\.?\d+)\s+(.+)$/);
  if (suffixMatch) {
    const numStr = suffixMatch[1].replace(/,/g, '');
    return { commodity: suffixMatch[2], quantity: parseFloat(numStr) };
  }

  // Plain number
  return { commodity: '', quantity: parseFloat(s.replace(/,/g, '')) };
}

/**
 * Parse a potentially multi-commodity amount list from hledger CSV.
 * Entries are separated by ", " (comma-space).
 * Examples: "20 EUR, 100.00 HRK", "$1", "0"
 */
export function parseAmountList(s: string): Map<string, number> {
  const result = new Map<string, number>();
  s = s.trim();
  if (!s || s === '0') {
    result.set('', 0);
    return result;
  }

  // Split on ", " but be careful — amounts can contain commas as thousands separators.
  // hledger separates multiple commodities with ", " where the space is followed by a
  // non-digit (the commodity symbol or a sign). We split on ", " then re-join if the
  // split produced fragments that don't look like complete amounts.
  const parts = splitAmountList(s);
  for (const part of parts) {
    const parsed = parseAmountString(part);
    const existing = result.get(parsed.commodity) || 0;
    result.set(parsed.commodity, existing + parsed.quantity);
  }
  return result;
}

/**
 * Split a multi-commodity amount string into individual amounts.
 * Handles the tricky case where commas appear both as thousands separators
 * and as amount delimiters.
 */
function splitAmountList(s: string): string[] {
  // hledger CSV multi-commodity format uses ", " as separator.
  // A thousands separator comma is always followed by digits (e.g., "18,000,000").
  // A delimiter comma is followed by a space then a non-digit or sign+digit.
  const results: string[] = [];
  let current = '';

  for (let i = 0; i < s.length; i++) {
    if (s[i] === ',' && i + 1 < s.length && s[i + 1] === ' ') {
      // Check if what follows the ", " looks like a new amount
      const rest = s.substring(i + 2).trimStart();
      // New amount starts with: digit, sign, or currency symbol
      // Thousands-sep comma is followed by exactly 3 digits then another separator/end
      const nextChar = rest[0];
      if (nextChar && !/^\d{3}[,.\s]/.test(s.substring(i + 1, i + 5))) {
        results.push(current.trim());
        current = '';
        i++; // skip the space
        continue;
      }
    }
    current += s[i];
  }
  if (current.trim()) results.push(current.trim());
  return results;
}

/**
 * Parse a simple CSV row (handles quoted fields with commas).
 */
function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
