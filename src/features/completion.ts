/**
 * Completion provider for hledger language server
 *
 * Provides intelligent auto-completion for:
 * - Account names
 * - Payee names
 * - Commodity symbols
 * - Directive keywords
 * - Include file paths
 * - Tags
 */

import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, TextEdit } from 'vscode-languageserver-protocol';
import * as fs from 'fs';
import * as path from 'path';
import { toFilePath } from '../utils/uri';
import { ParsedDocument } from '../types';
import { transactionAnalyzer } from './transactionAnalyzer';
import { URI } from 'vscode-uri';
import { type CompletionOptions } from '../server/settings';

export class CompletionProvider {
  private accounts: Array<{ name: string; declared: boolean }> = [];
  private payees: Array<{ name: string; declared: boolean }> = [];
  private commodities: Array<{ name: string; declared: boolean }> = [];
  private tags: Array<{ name: string; declared: boolean }> = [];

  /**
   * Update the list of known accounts
   */
  updateAccounts(accounts: Map<string, { name: string; declared: boolean }> | Array<{ name: string; declared: boolean }>) {
    this.accounts = Array.isArray(accounts) ? accounts : Array.from(accounts.values());
  }

  /**
   * Update the list of known payees
   */
  updatePayees(payees: Map<string, { name: string; declared: boolean }> | Array<{ name: string; declared: boolean }>) {
    this.payees = Array.isArray(payees) ? payees : Array.from(payees.values());
  }

  /**
   * Update the list of known commodities
   */
  updateCommodities(commodities: Map<string, { name: string; declared: boolean }> | Array<{ name: string; declared: boolean }>) {
    this.commodities = Array.isArray(commodities) ? commodities : Array.from(commodities.values());
  }

  /**
   * Update the list of known tags
   */
  updateTags(tags: Map<string, { name: string; declared: boolean }> | Array<{ name: string; declared: boolean }>) {
    this.tags = Array.isArray(tags) ? tags : Array.from(tags.values());
  }

  /**
   * Get completion items for the current position
   */
  getCompletionItems(
    document: TextDocument,
    position: Position,
    parsed?: ParsedDocument,
    settings?: Partial<CompletionOptions>
  ): CompletionItem[] {
    const line = document.getText({
      start: { line: position.line, character: 0 },
      end: { line: position.line, character: position.character }
    });

    // Include directive - suggest file paths
    const includeMatch = line.match(/^include\s+(.*)$/);
    if (includeMatch) {
      return this.getIncludePathCompletions(URI.parse(document.uri), includeMatch[1]);
    }

    // Comment - suggest tags (tags appear after ; in format tag:value)
    const commentMatch = line.match(/;([^;]*?)$/);
    if (commentMatch) {
      const commentPart = commentMatch[1];
      // Check if we're typing a tag name (after whitespace or after another tag)
      if (/(?:^|\s)(\w*)$/.test(commentPart)) {
        return this.getTagCompletions(settings);
      }
    }

    // Cost notation - suggest commodities after @ or @@
    if (/^\s+/.test(line) && !commentMatch) {
      // Check if cursor is after @ or @@ (for cost notation)
      const costMatch = line.match(/@@?\s*[^\s]*$/);
      if (costMatch) {
        return this.getCommodityCompletions(settings);
      }

      // Otherwise, suggest accounts for posting line
      // Try to get smart suggestions based on current transaction context
      // Calculate range for replacement
      const accountMatch = line.match(/^\s+(.*)$/);
      let range: Range | undefined;
      if (accountMatch) {
        const startChar = line.length - accountMatch[1].length;
        range = {
          start: { line: position.line, character: startChar },
          end: position
        };
      }

      if (parsed) {
        const payee = this.getCurrentTransactionPayee(document, position);
        if (payee) {
          return this.getSmartAccountCompletions(payee, parsed, settings, range);
        }
      }
      return this.getAccountCompletions(settings, range);
    }

    // Transaction header - suggest payees
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(line) && !commentMatch) {
      return this.getPayeeCompletions(settings);
    }

    // Directive line
    if (line.trim().length === 0 || /^[a-z]/.test(line.trim())) {
      return this.getDirectiveCompletions();
    }

    return [];
  }

  /**
   * Get account name completions
   */
  private getAccountCompletions(settings?: Partial<CompletionOptions>, range?: Range): CompletionItem[] {
    const onlyDeclared = settings?.onlyDeclaredAccounts ?? true;
    const filtered = onlyDeclared ? this.accounts.filter(a => a.declared) : this.accounts;

    return filtered.map(account => ({
      label: account.name,
      kind: CompletionItemKind.Field,
      detail: 'Account',
      textEdit: range ? TextEdit.replace(range, account.name) : undefined
    }));
  }

  /**
   * Get payee completions
   */
  private getPayeeCompletions(settings?: Partial<CompletionOptions>): CompletionItem[] {
    const onlyDeclared = settings?.onlyDeclaredPayees ?? true;
    const filtered = onlyDeclared ? this.payees.filter(p => p.declared) : this.payees;

    return filtered.map(payee => ({
      label: payee.name,
      kind: CompletionItemKind.Text,
      detail: 'Payee'
    }));
  }

  /**
   * Get directive keyword completions
   */
  private getDirectiveCompletions(): CompletionItem[] {
    const directives = [
      { label: 'account', detail: 'Declare an account' },
      { label: 'commodity', detail: 'Declare a commodity' },
      { label: 'payee', detail: 'Declare a payee' },
      { label: 'tag', detail: 'Declare a tag' },
      { label: 'include', detail: 'Include another file' },
      { label: 'alias', detail: 'Define an account alias' }
    ];

    return directives.map(d => ({
      label: d.label,
      kind: CompletionItemKind.Keyword,
      detail: d.detail
    }));
  }

  /**
   * Get commodity completions
   */
  getCommodityCompletions(settings?: Partial<CompletionOptions>): CompletionItem[] {
    const onlyDeclared = settings?.onlyDeclaredCommodities ?? true;
    const filtered = onlyDeclared ? this.commodities.filter(c => c.declared) : this.commodities;

    return filtered.map(commodity => ({
      label: commodity.name,
      kind: CompletionItemKind.Unit,
      detail: 'Commodity'
    }));
  }

  /**
   * Get tag name completions
   */
  getTagCompletions(settings?: Partial<CompletionOptions>): CompletionItem[] {
    const onlyDeclared = settings?.onlyDeclaredTags ?? true;
    const filtered = onlyDeclared ? this.tags.filter(t => t.declared) : this.tags;

    return filtered.map(tag => ({
      label: tag.name,
      kind: CompletionItemKind.Property,
      detail: 'Tag',
      insertText: `${tag.name}:`
    }));
  }

  /**
   * Get include file path completions
   */
  private getIncludePathCompletions(documentUri: URI, partialPath: string): CompletionItem[] {
    try {
      // Convert URI to file path
      const currentFilePath = toFilePath(documentUri);

      const currentDir = path.dirname(currentFilePath);

      // Determine which directory to search based on partialPath
      let searchDir: string;

      if (partialPath.endsWith('/') || partialPath.endsWith(path.sep)) {
        // If ends with /, search in that directory (e.g., "../" -> parent dir, "../monthly/" -> monthly dir)
        searchDir = path.resolve(currentDir, partialPath);
      } else if (partialPath.includes('/') || partialPath.includes(path.sep)) {
        // Has a path separator but doesn't end with it
        // Extract directory part: "../monthly/feb" -> search in "../monthly"
        const dirPart = path.dirname(partialPath);
        searchDir = path.resolve(currentDir, dirPart);
      } else if (partialPath === '..' || partialPath === '.') {
        // Special case: typing ".." or "." should show parent/current directory
        searchDir = path.resolve(currentDir, partialPath);
      } else {
        // No path separator, search in current directory
        searchDir = currentDir;
      }

      // Check if directory exists
      if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
        return [];
      }

      // Read directory contents
      const files = fs.readdirSync(searchDir);

      const completions: CompletionItem[] = [];

      for (const file of files) {
        const filePath = path.join(searchDir, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
          // Add directories with trailing slash
          completions.push({
            label: file + '/',
            kind: CompletionItemKind.Folder,
            detail: 'Directory'
          });
        } else if (file.endsWith('.journal') || file.endsWith('.hledger')) {
          // Add journal files
          completions.push({
            label: file,
            kind: CompletionItemKind.File,
            detail: 'Journal file'
          });
        }
      }

      return completions;
    } catch (error) {
      // If any error occurs (permissions, etc.), return empty array
      return [];
    }
  }

  /**
   * Get the payee of the current transaction being edited
   */
  private getCurrentTransactionPayee(document: TextDocument, position: Position): string | null {
    const lines = document.getText().split('\n');

    // Search backwards from current line to find transaction header
    for (let i = position.line; i >= 0; i--) {
      const line = lines[i];

      // Transaction header with payee
      const match = line.match(/^\d{4}[-/]\d{2}[-/]\d{2}(?:\s+[*!])?(?:\s+\([^)]+\))?\s+(.+?)(?:\s*;|$)/);
      if (match) {
        return match[1].trim();
      }

      // Stop if we hit a non-transaction line (directive or empty)
      if (line.trim() && !line.match(/^\s+/) && !line.match(/^\d{4}/)) {
        break;
      }
    }

    return null;
  }

  /**
   * Get smart account completions based on payee history
   */
  private getSmartAccountCompletions(
    payee: string,
    parsed: ParsedDocument,
    settings?: Partial<CompletionOptions>,
    range?: Range
  ): CompletionItem[] {
    // Analyze the parsed document to build patterns
    transactionAnalyzer.analyze(parsed);

    // Get accounts historically used with this payee
    const patterns = transactionAnalyzer.getAccountsForPayee(payee, 5);
    const suggestedAccounts = new Set(patterns.map(p => p.account));

    // Get all accounts with frequency info
    const frequencyMap = new Map(
      transactionAnalyzer.getAccountsByFrequency().map(f => [f.account, f.count])
    );

    // Filter accounts based on settings
    const onlyDeclared = settings?.onlyDeclaredAccounts ?? true;
    const filtered = onlyDeclared ? this.accounts.filter(a => a.declared) : this.accounts;

    // Create completion items with smart sorting
    const items = filtered.map(account => {
      const item: CompletionItem = {
        label: account.name,
        kind: CompletionItemKind.Field,
        detail: 'Account',
        textEdit: range ? TextEdit.replace(range, account.name) : undefined
      };

      // Add sort text to prioritize suggested accounts
      if (suggestedAccounts.has(account.name)) {
        const frequency = patterns.find(p => p.account === account.name)?.frequency || 0;
        // Use '0' prefix for suggested accounts to sort them first
        item.sortText = `0_${String(1000 - frequency).padStart(4, '0')}_${account.name}`;
        item.detail = `Account (used ${frequency}x with ${payee})`;
      } else {
        // Use '1' prefix for other accounts, sorted by global frequency
        const freq = frequencyMap.get(account.name) || 0;
        item.sortText = `1_${String(10000 - freq).padStart(5, '0')}_${account.name}`;
      }

      return item;
    });

    return items;
  }
}

export const completionProvider = new CompletionProvider();
