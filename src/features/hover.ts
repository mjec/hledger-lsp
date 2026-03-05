/**
 * Hover provider for hledger language server
 *
 * Provides comprehensive hover information for:
 * - Accounts (type, declaration location, usage count)
 * - Payees (declaration location, usage count)
 * - Commodities (format information, declaration location)
 * - Tags (declaration location, usage statistics)
 * - Transaction headers (totals per commodity)
 * - Dates (formatted date information)
 */

import { Hover, MarkupKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument } from '../types';
import { isTransactionHeader, isPosting, extractAccountFromPosting, getIndentationLevel } from '../utils/index';
import { calculateTransactionBalanceSimple } from '../utils/balanceCalculator';
import { formatAmount } from '../utils/amountFormatter';
import { toFilePath } from '../utils/uri';
import * as path from 'path';

import { HledgerSettings } from '../server/settings';
import { URI } from 'vscode-uri';

export class HoverProvider {
  /**
   * Provide hover information at the given document position
   */
  provideHover(document: TextDocument, line: number, character: number, parsed?: ParsedDocument, settings?: HledgerSettings): Hover | null {
    if (!parsed) {
      return this.provideBasicHover(document, line, character);
    }

    const fullLine = document.getText({
      start: { line, character: 0 },
      end: { line, character: Number.MAX_SAFE_INTEGER }
    });

    // Check for tag (in comments) before other checks
    if (fullLine.includes(';') || fullLine.includes('#')) {
      // Check if cursor is after the comment marker
      const semicolonPos = fullLine.indexOf(';');
      const hashPos = fullLine.indexOf('#');
      const commentStart = Math.min(
        semicolonPos >= 0 ? semicolonPos : Infinity,
        hashPos >= 0 ? hashPos : Infinity
      );

      if (character > commentStart) {
        // If token contains ':', extract just the tag name part
        const token = this.getTokenAtPosition(fullLine, character);
        if (token) {
          let tagName = token;
          if (token.includes(':')) {
            tagName = token.substring(0, token.indexOf(':'));
          }

          // Check if this is a tag (tag name followed by colon in the line)
          if (tagName && fullLine.includes(`${tagName}:`)) {
            return this.provideTagHover(tagName, parsed);
          }
        }

        // If in comment but not a tag, return null
        return null;
      }
    }

    // Check if we are on a posting line (account) - Robust check for accounts with spaces
    // This takes priority over generic token scanning for account, 
    // because extractAccountFromPosting handles "Expenses:Credit Card" correctly
    // whereas getTokenAtPosition breaks on spaces.
    if (isPosting(fullLine)) {
      const accountName = extractAccountFromPosting(fullLine);
      if (accountName) {
        const indentation = getIndentationLevel(fullLine);
        const start = indentation;
        const end = start + accountName.length;

        // Check if cursor is within the account name
        if (character >= start && character <= end) {
          return this.provideAccountHover(accountName, parsed);
        }
      }
    }

    // Fallback to token matching for other items
    // Get token at cursor position
    const token = this.getTokenAtPosition(fullLine, character);
    if (!token) return null;

    // Check for date first (highest priority)
    if (this.isDate(token)) {
      return this.provideDateHover(token);
    }

    // Check for account (contains ':') - Legacy check, mostly covered above but good fallback
    if (token.includes(':')) {
      return this.provideAccountHover(token, parsed);
    }

    // Check for commodity
    const commodity = parsed.commodities.get(token);
    if (commodity) {
      return this.provideCommodityHover(commodity, parsed);
    }

    // Check for payee - only if token is part of payee name
    const payee = parsed.payees.get(token) || Array.from(parsed.payees.values()).find(p => p.name.toLowerCase().includes(token.toLowerCase()));
    if (payee?.declared) {
      return this.providePayeeHover(payee, parsed);
    }

    // Check if we're on a transaction header (lowest priority)
    const trimmedLine = fullLine.trim();
    const documentUri: URI = URI.parse(document.uri);
    if (isTransactionHeader(trimmedLine)) {
      return this.provideTransactionHover(line, parsed, documentUri, settings);
    }

    return null;
  }

  /**
   * Get the token at a specific character position
   */
  private getTokenAtPosition(line: string, character: number): string | null {
    const col = Math.min(character, line.length);

    // Find token boundaries
    let start = col - 1;
    while (start >= 0) {
      const ch = line[start];
      if (/\s|;|#|\|/.test(ch)) break;
      start--;
    }
    start++;

    let end = col;
    while (end < line.length) {
      const ch = line[end];
      if (/\s|;|#|\|/.test(ch)) break;
      end++;
    }

    const token = line.substring(start, end).trim();
    return token || null;
  }

  /**
   * Check if token is a date
   */
  private isDate(token: string): boolean {
    return /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(token);
  }

  /**
   * Provide hover for dates
   */
  private provideDateHover(dateStr: string): Hover {
    const date = new Date(dateStr.replace(/\//g, '-'));
    // Use UTC to avoid timezone shifting (e.g., "2025-05-01" should display as May 1, not April 30 in US timezones)
    const formatted = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**Date**\n\n${formatted}`
      }
    };
  }

  /**
   * Provide hover for accounts
   */
  private provideAccountHover(accountName: string, parsed: ParsedDocument): Hover {
    const account = parsed.accounts.get(accountName);

    if (!account) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Account**\n\n\`${accountName}\``
        }
      };
    }

    const parts: string[] = [`**Account**\n\n\`${accountName}\``];

    // Add account type if available
    if (account.type) {
      const typeCapitalized = account.type.charAt(0).toUpperCase() + account.type.slice(1);
      parts.push(`**Type:** ${typeCapitalized}`);
    }

    // Add declaration status and location
    if (account.declared) {
      parts.push(`**Status:** Declared`);
      if (account.sourceUri) {
        const filePath = toFilePath(account.sourceUri);
        let fileName = path.basename(filePath);
        // Handle edge case where fsPath is invalid (e.g., file://test.journal with 2 slashes)
        if (!fileName || fileName === '/') {
          fileName = path.basename(account.sourceUri.toString().replace(/^file:\/\/+/, ''));
        }
        const lineNum = (account.line ?? 0) + 1;
        parts.push(`**Location:** ${fileName}:${lineNum}`);
      }
    } else {
      parts.push(`**Status:** Undeclared (inferred from usage)`);
    }

    // Count usage
    const usageCount = this.countAccountUsage(accountName, parsed);
    if (usageCount > 0) {
      parts.push(`**Usage:** ${usageCount} posting${usageCount !== 1 ? 's' : ''}`);
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: parts.join('\n\n')
      }
    };
  }

  /**
   * Provide hover for commodities
   */
  private provideCommodityHover(commodity: any, parsedDoc?: ParsedDocument): Hover {
    const parts: string[] = [`**Commodity**\n\n\`${commodity.name}\``];

    // Add declaration status
    if (commodity.declared) {
      parts.push(`**Status:** Declared`);
      if (commodity.sourceUri) {
        const filePath = toFilePath(commodity.sourceUri);
        let fileName = path.basename(filePath);
        // Handle edge case where fsPath is invalid (e.g., file://test.journal with 2 slashes)
        if (!fileName || fileName === '/') {
          fileName = path.basename(commodity.sourceUri.toString().replace(/^file:\/\/+/, ''));
        }
        const lineNum = (commodity.line ?? 0) + 1;
        parts.push(`**Location:** ${fileName}:${lineNum}`);
      }
    } else {
      parts.push(`**Status:** Undeclared (inferred from usage)`);
    }

    // Add format information if available
    if (commodity.format) {
      const fmt = commodity.format;
      const formatParts: string[] = ['**Format:**'];

      if (fmt.symbolOnLeft !== undefined) {
        formatParts.push(`- Symbol position: ${fmt.symbolOnLeft ? 'Left' : 'Right'}`);
      }

      if (fmt.spaceBetween !== undefined) {
        formatParts.push(`- Space between: ${fmt.spaceBetween ? 'Yes' : 'No'}`);
      }

      if (fmt.decimalMark) {
        formatParts.push(`- Decimal mark: \`${fmt.decimalMark}\``);
      }

      if (fmt.thousandsSeparator !== undefined) {
        const sep = fmt.thousandsSeparator === null ? 'None' : `\`${fmt.thousandsSeparator}\``;
        formatParts.push(`- Thousands separator: ${sep}`);
      }

      if (fmt.precision !== null && fmt.precision !== undefined) {
        formatParts.push(`- Precision: ${fmt.precision} decimal place${fmt.precision !== 1 ? 's' : ''}`);
      }

      if (formatParts.length > 1) {
        parts.push(formatParts.join('\n'));
      }
    }

    // Add price history if available
    if (parsedDoc) {
      const prices = parsedDoc.priceDirectives.filter(p => p.commodity === commodity.name);
      if (prices.length > 0) {
        const dates = prices.map(p => p.date).sort();
        const latest = prices.sort((a, b) => b.date.localeCompare(a.date))[0];
        const latestAmountStr = latest.amount.commodity
          ? `${latest.amount.quantity} ${latest.amount.commodity}`
          : `${latest.amount.quantity}`;
        if (prices.length === 1) {
          parts.push(`**Prices:** 1 entry (${dates[0]}), latest: ${latestAmountStr}`);
        } else {
          parts.push(`**Prices:** ${prices.length} entries (${dates[0]} to ${dates[dates.length - 1]}), latest: ${latestAmountStr}`);
        }
      }
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: parts.join('\n\n')
      }
    };
  }

  /**
   * Provide hover for payees
   */
  private providePayeeHover(payee: any, parsed: ParsedDocument): Hover {
    const parts: string[] = [`**Payee**\n\n\`${payee.name}\``];

    // Add declaration status
    if (payee.declared) {
      parts.push(`**Status:** Declared`);
      if (payee.sourceUri) {
        const filePath = toFilePath(payee.sourceUri);
        let fileName = path.basename(filePath);
        // Handle edge case where fsPath is invalid (e.g., file://test.journal with 2 slashes)
        if (!fileName || fileName === '/') {
          fileName = path.basename(payee.sourceUri.toString().replace(/^file:\/\/+/, ''));
        }
        const lineNum = (payee.line ?? 0) + 1;
        parts.push(`**Location:** ${fileName}:${lineNum}`);
      }
    } else {
      parts.push(`**Status:** Undeclared (inferred from usage)`);
    }

    // Count transactions with this payee
    const transactionCount = parsed.transactions.filter(t => t.payee === payee.name).length;
    if (transactionCount > 0) {
      parts.push(`**Transactions:** ${transactionCount}`);
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: parts.join('\n\n')
      }
    };
  }

  /**
   * Provide hover for tags
   */
  private provideTagHover(tagName: string, parsed: ParsedDocument): Hover {
    const tag = parsed.tags.get(tagName);

    if (!tag) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Tag**\n\n\`${tagName}:\``
        }
      };
    }

    const parts: string[] = [`**Tag**\n\n\`${tagName}:\``];

    // Add declaration status
    if (tag.declared) {
      parts.push(`**Status:** Declared`);
      if (tag.sourceUri) {
        const filePath = toFilePath(tag.sourceUri);
        let fileName = path.basename(filePath);
        // Handle edge case where fsPath is invalid (e.g., file://test.journal with 2 slashes)
        if (!fileName || fileName === '/') {
          fileName = path.basename(tag.sourceUri.toString().replace(/^file:\/\/+/, ''));
        }
        const lineNum = (tag.line ?? 0) + 1;
        parts.push(`**Location:** ${fileName}:${lineNum}`);
      }
    } else {
      parts.push(`**Status:** Undeclared (inferred from usage)`);
    }

    // Count tag usage across transactions and postings
    let usageCount = 0;
    for (const transaction of parsed.transactions) {
      if (transaction.tags && tagName in transaction.tags) {
        usageCount++;
      }
      for (const posting of transaction.postings) {
        if (posting.tags && tagName in posting.tags) {
          usageCount++;
        }
      }
    }

    if (usageCount > 0) {
      parts.push(`**Usage:** ${usageCount} time${usageCount !== 1 ? 's' : ''}`);
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: parts.join('\n\n')
      }
    };
  }

  /**
   * Provide hover for transaction headers
   */
  private provideTransactionHover(lineNumber: number, parsed: ParsedDocument, documentUri: URI, settings?: HledgerSettings): Hover | null {
    // Find the transaction at this line

    const transaction = parsed.transactions.find(t => {
      if (t.line !== lineNumber) return false;

      // If transaction has sourceUri, check it. If not, assume it matches (std parser behavior?)
      // Actually, parseTransactionHeader adds sourceUri.
      if (t.sourceUri) {
        return t.sourceUri.toString() === documentUri.toString();
      }
      return true;
    });

    if (!transaction) return null;

    const parts: string[] = [`**Transaction**\n\n\`${transaction.description}\``];

    // Add status if present
    if (transaction.status) {
      const statusText = transaction.status === 'cleared' ? 'Cleared (*)' :
        transaction.status === 'pending' ? 'Pending (!)' : 'Unmarked';
      parts.push(`**Status:** ${statusText}`);
    }

    // Add code if present
    if (transaction.code) {
      parts.push(`**Code:** \`${transaction.code}\``);
    }

    // Calculate totals per commodity
    const totals = calculateTransactionBalanceSimple(transaction);
    if (Object.keys(totals).length > 0) {
      const totalLines: string[] = ['**Totals:**'];
      for (const [commodity, total] of Object.entries(totals)) {
        const sign = total >= 0 ? '+' : '';
        const formattedAmount = commodity
          ? formatAmount(total, commodity, parsed, settings?.formatting)
          : total.toFixed(2);
        totalLines.push(`- ${sign}${formattedAmount}`);
      }
      parts.push(totalLines.join('\n'));
    }

    // Add posting count
    parts.push(`**Postings:** ${transaction.postings.length}`);

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: parts.join('\n\n')
      }
    };
  }

  /**
   * Count how many times an account is used
   */
  private countAccountUsage(accountName: string, parsed: ParsedDocument): number {
    let count = 0;
    for (const transaction of parsed.transactions) {
      for (const posting of transaction.postings) {
        if (posting.account === accountName) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Provide basic hover without parsed data
   */
  private provideBasicHover(document: TextDocument, line: number, character: number): Hover | null {
    const fullLine = document.getText({
      start: { line, character: 0 },
      end: { line, character: Number.MAX_SAFE_INTEGER }
    });

    const token = this.getTokenAtPosition(fullLine, character);
    if (!token) return null;

    if (this.isDate(token)) {
      return this.provideDateHover(token);
    }

    if (token.includes(':')) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Account**\n\n\`${token}\``
        }
      };
    }

    return null;
  }
}

export const hoverProvider = new HoverProvider();
