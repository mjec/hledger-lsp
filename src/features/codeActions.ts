/**
 * Code actions provider for quick fixes and refactorings
 */

import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  TextEdit,
  WorkspaceEdit,
  Range,
  Position
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { ParsedDocument } from '../types';
import { formatAmount } from '../utils/amountFormatter';

export class CodeActionProvider {
  /**
   * Provide code actions for the given range and diagnostics
   */
  provideCodeActions(
    document: TextDocument,
    range: Range,
    diagnostics: Diagnostic[],
    parsedDoc: ParsedDocument
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    // Quick fixes for diagnostics
    for (const diagnostic of diagnostics) {
      // Quick fix for undeclared accounts
      if (diagnostic.code === 'undeclared-account') {
        const data = diagnostic.data as { accountName: string } | undefined;
        if (data?.accountName) {
          actions.push(this.createAddAccountDeclarationAction(document, data.accountName, diagnostic, parsedDoc));
        }
      }

      // Quick fix for undeclared payees
      if (diagnostic.code === 'undeclared-payee') {
        const data = diagnostic.data as { payeeName: string } | undefined;
        if (data?.payeeName) {
          actions.push(this.createAddPayeeDeclarationAction(document, data.payeeName, diagnostic, parsedDoc));
        }
      }

      // Quick fix for undeclared commodities
      if (diagnostic.code === 'undeclared-commodity') {
        const data = diagnostic.data as { commodityName: string } | undefined;
        if (data?.commodityName) {
          actions.push(this.createAddCommodityDeclarationAction(document, data.commodityName, diagnostic, parsedDoc));
        }
      }

      // Quick fix for undeclared tags
      if (diagnostic.code === 'undeclared-tag') {
        const data = diagnostic.data as { tagName: string } | undefined;
        if (data?.tagName) {
          actions.push(this.createAddTagDeclarationAction(document, data.tagName, diagnostic, parsedDoc));
        }
      }
    }

    // Check for split posting refactoring actions
    const postingInfo = this.getPostingAtPosition(document, range.start);
    if (postingInfo) {
      actions.push(...this.createSplitPostingActions(document, postingInfo, parsedDoc));
    }

    // Note: Rename refactoring is now handled via the LSP rename provider
    // (vim.lsp.buf.rename() or F2), not through code actions

    return actions;
  }

  /**
   * Create a code action to add an account declaration
   */
  private createAddAccountDeclarationAction(
    document: TextDocument,
    accountName: string,
    diagnostic: Diagnostic,
    parsedDoc: ParsedDocument
  ): CodeAction {
    const insertPosition = this.findInsertPositionForDirective(document, parsedDoc, 'account');
    const edit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.insert(insertPosition, `account ${accountName}\n`)
        ]
      }
    };

    const action: CodeAction = {
      title: `Add declaration for account '${accountName}'`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit
    };

    return action;
  }

  /**
   * Create a code action to add a payee declaration
   */
  private createAddPayeeDeclarationAction(
    document: TextDocument,
    payeeName: string,
    diagnostic: Diagnostic,
    parsedDoc: ParsedDocument
  ): CodeAction {
    const insertPosition = this.findInsertPositionForDirective(document, parsedDoc, 'payee');
    const edit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.insert(insertPosition, `payee ${payeeName}\n`)
        ]
      }
    };

    const action: CodeAction = {
      title: `Add declaration for payee '${payeeName}'`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit
    };

    return action;
  }

  /**
   * Create a code action to add a commodity declaration
   */
  private createAddCommodityDeclarationAction(
    document: TextDocument,
    commodityName: string,
    diagnostic: Diagnostic,
    parsedDoc: ParsedDocument
  ): CodeAction {
    const insertPosition = this.findInsertPositionForDirective(document, parsedDoc, 'commodity');
    const edit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.insert(insertPosition, `commodity ${commodityName}\n`)
        ]
      }
    };

    const action: CodeAction = {
      title: `Add declaration for commodity '${commodityName}'`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit
    };

    return action;
  }

  /**
   * Create a code action to add a tag declaration
   */
  private createAddTagDeclarationAction(
    document: TextDocument,
    tagName: string,
    diagnostic: Diagnostic,
    parsedDoc: ParsedDocument
  ): CodeAction {
    const insertPosition = this.findInsertPositionForDirective(document, parsedDoc, 'tag');
    const edit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.insert(insertPosition, `tag ${tagName}\n`)
        ]
      }
    };

    const action: CodeAction = {
      title: `Add declaration for tag '${tagName}'`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit
    };

    return action;
  }

  /**
   * Find the best position to insert a directive
   * Tries to group directives of the same type together
   */
  private findInsertPositionForDirective(
    document: TextDocument,
    parsedDoc: ParsedDocument,
    directiveType: string
  ): Position {
    const lines = document.getText().split('\n');
    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

    const directivesOfType = parsedDoc.directives
      .filter(d => d.type === directiveType && d.sourceUri?.toString() === documentUri);

    if (directivesOfType.length > 0) {
      // Insert after the last directive of the same type
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.trim().startsWith(`${directiveType} `)) {
          return Position.create(i + 1, 0);
        }
      }
    }

    // Find the last directive of any type
    const allDirectives = parsedDoc.directives
      .filter(d => d.sourceUri?.toString() === documentUri);

    if (allDirectives.length > 0) {
      // Insert after the last directive
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('account ') ||
          line.startsWith('commodity ') ||
          line.startsWith('payee ') ||
          line.startsWith('tag ') ||
          line.startsWith('include ') ||
          line.startsWith('alias ')) {
          return Position.create(i + 1, 0);
        }
      }
    }

    // If no directives, insert at the top of the file
    return Position.create(0, 0);
  }

  /**
   * Get the item (account, payee, commodity, tag) at the cursor position
   */
  public getItemAtCursor(
    document: TextDocument,
    position: Position,
    parsedDoc: ParsedDocument
  ): { type: 'account' | 'payee' | 'commodity' | 'tag'; name: string } | null {
    const lines = document.getText().split('\n');
    if (position.line >= lines.length) {
      return null;
    }

    const line = lines[position.line];
    if (!line) {
      return null;
    }
    const char = position.character;

    // Check if on an account directive
    const accountDirectiveMatch = line.match(/^account\s+(.+?)(?:\s|$)/);
    if (accountDirectiveMatch && char >= line.indexOf(accountDirectiveMatch[1])) {
      return { type: 'account', name: accountDirectiveMatch[1].trim() };
    }

    // Check if on a payee directive
    const payeeDirectiveMatch = line.match(/^payee\s+(.+?)(?:\s*;|$)/);
    if (payeeDirectiveMatch && char >= line.indexOf(payeeDirectiveMatch[1])) {
      return { type: 'payee', name: payeeDirectiveMatch[1].trim() };
    }

    // Check if on a commodity directive
    const commodityDirectiveMatch = line.match(/^commodity\s+(.+?)(?:\s|$)/);
    if (commodityDirectiveMatch && char >= line.indexOf(commodityDirectiveMatch[1])) {
      // Extract just the commodity symbol, not the format
      const commodityPart = commodityDirectiveMatch[1].trim().split(/\s+/)[0];
      return { type: 'commodity', name: commodityPart };
    }

    // Check if on a tag directive
    const tagDirectiveMatch = line.match(/^tag\s+(\w+)/);
    if (tagDirectiveMatch && char >= line.indexOf(tagDirectiveMatch[1])) {
      return { type: 'tag', name: tagDirectiveMatch[1] };
    }

    // Check if on an account in a posting
    if (line.match(/^\s+\S/)) { // Indented line (posting)
      const accountMatch = line.match(/^\s+([^;\s]+(?:\s+[^;\s]+)*?)(?:\s{2,}|\s+[-+$£€¥₹]|\s*$)/);
      if (accountMatch) {
        const accountName = accountMatch[1].trim();
        const accountStart = line.indexOf(accountName);
        const accountEnd = accountStart + accountName.length;
        if (char >= accountStart && char <= accountEnd) {
          return { type: 'account', name: accountName };
        }
      }

      // Check if on a commodity in a posting amount
      // Match common commodity symbols and currency codes
      const commodityRegex = /[$£€¥₹]|[A-Z]{3,4}\b/g;
      let commodityMatch;
      while ((commodityMatch = commodityRegex.exec(line)) !== null) {
        const commodityStart = commodityMatch.index;
        const commodityEnd = commodityStart + commodityMatch[0].length;
        if (char >= commodityStart && char <= commodityEnd) {
          return { type: 'commodity', name: commodityMatch[0] };
        }
      }
    }

    // Check if on a payee in a transaction header
    const txHeaderMatch = line.match(/^\d{4}[-/]\d{2}[-/]\d{2}(?:\s+[*!])?(?:\s+\([^)]+\))?\s+(.+?)(?:\s*;|$)/);
    if (txHeaderMatch) {
      const payeeName = txHeaderMatch[1].trim();
      const payeeStart = line.indexOf(payeeName);
      const payeeEnd = payeeStart + payeeName.length;
      if (char >= payeeStart && char <= payeeEnd) {
        return { type: 'payee', name: payeeName };
      }
    }

    // Check if on a tag in a comment
    const tagMatch = line.match(/;\s*(\w+):/g);
    if (tagMatch) {
      for (const match of tagMatch) {
        const tagName = match.match(/(\w+):/)?.[1];
        if (tagName) {
          const tagStart = line.indexOf(match) + match.indexOf(tagName);
          const tagEnd = tagStart + tagName.length;
          if (char >= tagStart && char <= tagEnd) {
            return { type: 'tag', name: tagName };
          }
        }
      }
    }

    return null;
  }

  /**
   * Create a rename refactoring action
   */
  private createRenameAction(
    document: TextDocument,
    item: { type: 'account' | 'payee' | 'commodity' | 'tag'; name: string },
    parsedDoc: ParsedDocument
  ): CodeAction {
    // Note: This creates a code action that would need user input for the new name
    // In a real implementation, this would trigger a rename dialog
    // For now, we'll create an action that shows it's available

    const action: CodeAction = {
      title: `Rename ${item.type} '${item.name}'...`,
      kind: CodeActionKind.Refactor,
      // In a full implementation, this would use the 'command' field to trigger
      // a rename dialog. For now, we mark it as available but don't provide an edit.
      command: {
        title: `Rename ${item.type}`,
        command: 'hledger.rename',
        arguments: [document.uri, item.type, item.name]
      }
    };

    return action;
  }

  /**
   * Find all occurrences of an account name in the document
   */
  public findAccountReferences(
    document: TextDocument,
    accountName: string,
    parsedDoc: ParsedDocument
  ): Range[] {
    const ranges: Range[] = [];
    const lines = document.getText().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Check account directives
      const accountDirectiveMatch = line.match(/^account\s+(.+?)(?:\s|$)/);
      if (accountDirectiveMatch && accountDirectiveMatch[1].trim() === accountName) {
        const start = line.indexOf(accountName);
        ranges.push(Range.create(i, start, i, start + accountName.length));
        continue;
      }

      // Check postings
      if (line.match(/^\s+\S/)) {
        const accountMatch = line.match(/^\s+([^;\s]+(?:\s+[^;\s]+)*?)(?:\s{2,}|\s+[-+$£€¥₹]|\s*$)/);
        if (accountMatch && accountMatch[1].trim() === accountName) {
          const start = line.indexOf(accountName);
          ranges.push(Range.create(i, start, i, start + accountName.length));
        }
      }
    }

    return ranges;
  }

  /**
   * Find all occurrences of a payee name in the document
   */
  public findPayeeReferences(
    document: TextDocument,
    payeeName: string,
    parsedDoc: ParsedDocument
  ): Range[] {
    const ranges: Range[] = [];
    const lines = document.getText().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Check payee directives (match everything after "payee " up to comment or end of line)
      if (line.startsWith('payee ')) {
        const payeeText = line.substring(6).split(';')[0].trim();
        if (payeeText === payeeName) {
          const start = line.indexOf(payeeName);
          ranges.push(Range.create(i, start, i, start + payeeName.length));
          continue;
        }
      }

      // Check transaction headers
      const txHeaderMatch = line.match(/^\d{4}[-/]\d{2}[-/]\d{2}(?:\s+[*!])?(?:\s+\([^)]+\))?\s+(.+?)(?:\s*;|$)/);
      if (txHeaderMatch && txHeaderMatch[1].trim() === payeeName) {
        const start = line.indexOf(payeeName);
        ranges.push(Range.create(i, start, i, start + payeeName.length));
      }
    }

    return ranges;
  }

  /**
   * Find all occurrences of a commodity in the document
   */
  public findCommodityReferences(
    document: TextDocument,
    commodityName: string,
    parsedDoc: ParsedDocument
  ): Range[] {
    const ranges: Range[] = [];
    const lines = document.getText().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Check commodity directives
      const commodityDirectiveMatch = line.match(/^commodity\s+(.+?)(?:\s|$)/);
      if (commodityDirectiveMatch) {
        const commodityPart = commodityDirectiveMatch[1].trim().split(/\s+/)[0];
        if (commodityPart === commodityName) {
          const start = line.indexOf(commodityName);
          ranges.push(Range.create(i, start, i, start + commodityName.length));
          continue;
        }
      }

      // Check for commodity in amounts (this is a simple match, may need refinement)
      const regex = new RegExp(`\\b${this.escapeRegExp(commodityName)}\\b`, 'g');
      let match;
      while ((match = regex.exec(line)) !== null) {
        ranges.push(Range.create(i, match.index, i, match.index + commodityName.length));
      }
    }

    return ranges;
  }

  /**
   * Find all occurrences of a tag in the document
   */
  public findTagReferences(
    document: TextDocument,
    tagName: string,
    parsedDoc: ParsedDocument
  ): Range[] {
    const ranges: Range[] = [];
    const lines = document.getText().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Check tag directives
      const tagDirectiveMatch = line.match(/^tag\s+(\w+)/);
      if (tagDirectiveMatch && tagDirectiveMatch[1] === tagName) {
        const start = line.indexOf(tagName);
        ranges.push(Range.create(i, start, i, start + tagName.length));
        continue;
      }

      // Check for tags in comments
      const regex = new RegExp(`\\b${tagName}:`, 'g');
      let match;
      while ((match = regex.exec(line)) !== null) {
        ranges.push(Range.create(i, match.index, i, match.index + tagName.length));
      }
    }

    return ranges;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Create workspace edit to rename an item across all its references
   */
  public createRenameEdit(
    document: TextDocument,
    item: { type: 'account' | 'payee' | 'commodity' | 'tag'; name: string },
    newName: string,
    parsedDoc: ParsedDocument
  ): WorkspaceEdit {
    let ranges: Range[] = [];

    switch (item.type) {
      case 'account':
        ranges = this.findAccountReferences(document, item.name, parsedDoc);
        break;
      case 'payee':
        ranges = this.findPayeeReferences(document, item.name, parsedDoc);
        break;
      case 'commodity':
        ranges = this.findCommodityReferences(document, item.name, parsedDoc);
        break;
      case 'tag':
        ranges = this.findTagReferences(document, item.name, parsedDoc);
        break;
    }

    const edits: TextEdit[] = ranges.map(range => TextEdit.replace(range, newName));

    return {
      changes: {
        [document.uri]: edits
      }
    };
  }

  /**
   * Get posting information at a given position
   */
  private getPostingAtPosition(
    document: TextDocument,
    position: Position
  ): { line: number; account: string; amount: { quantity: number; commodity: string } } | null {
    const lines = document.getText().split('\n');
    if (position.line >= lines.length) {
      return null;
    }

    const line = lines[position.line];
    if (!line || !line.match(/^\s+\S/)) {
      // Not an indented line (not a posting)
      return null;
    }

    // Parse the posting line to extract account and amount
    // Format: "    account name    amount"
    const match = line.match(/^\s+([^;\s]+(?:\s+[^;\s]+)*?)(?:\s{2,})([-+]?)([^;\s]*?)([$£€¥₹]|[A-Z]{3,4})?\s*([-+]?\d+(?:[.,]\d+)?)\s*([$£€¥₹]|[A-Z]{3,4})?/);

    if (!match) {
      return null;
    }

    const account = match[1].trim();
    const signBefore = match[2];
    const commodityBefore = match[4];
    const quantityStr = match[5];
    const commodityAfter = match[6];

    // Determine commodity and quantity
    const commodity = commodityBefore || commodityAfter;
    if (!commodity) {
      return null; // No commodity found
    }

    const quantity = parseFloat(quantityStr.replace(',', '.'));
    if (isNaN(quantity)) {
      return null;
    }

    // Apply sign
    const signedQuantity = signBefore === '-' ? -quantity : quantity;

    return {
      line: position.line,
      account,
      amount: {
        quantity: signedQuantity,
        commodity
      }
    };
  }

  /**
   * Create code actions for splitting a posting
   */
  private createSplitPostingActions(
    document: TextDocument,
    postingInfo: { line: number; account: string; amount: { quantity: number; commodity: string } },
    parsedDoc: ParsedDocument
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    // Add split actions for 2, 3, and 4 parts
    for (const parts of [2, 3, 4]) {
      actions.push(this.createSplitPostingAction(document, postingInfo, parts, parsedDoc));
    }

    return actions;
  }

  /**
   * Create a single split posting action
   */
  private createSplitPostingAction(
    document: TextDocument,
    postingInfo: { line: number; account: string; amount: { quantity: number; commodity: string } },
    parts: number,
    parsedDoc: ParsedDocument
  ): CodeAction {
    const splitAmounts = this.splitAmountEqually(postingInfo.amount, parts);
    const lines = document.getText().split('\n');
    const originalLine = lines[postingInfo.line];

    // Get the indentation from the original line
    const indentMatch = originalLine.match(/^(\s+)/);
    const indent = indentMatch ? indentMatch[1] : '    ';

    // Generate new posting lines
    const newPostings: string[] = [];

    // Leave the first account unchanged
    const formattedFirstAmount = formatAmount(splitAmounts[0].quantity, splitAmounts[0].commodity, parsedDoc);
    const firstPosting = `${indent}${postingInfo.account}${' '.repeat(Math.max(2, 40 - postingInfo.account.length))}${formattedFirstAmount}`;
    newPostings.push(firstPosting);
    for (let i = 1; i < parts; i++) {
      const suffix = i + 1;
      const newAccount = `${postingInfo.account}:${suffix}`;
      const amount = splitAmounts[i];

      // Format the amount
      const formattedAmount = formatAmount(amount.quantity, amount.commodity, parsedDoc);
      const newPosting = `${indent}${newAccount}${' '.repeat(Math.max(2, 40 - newAccount.length))}${formattedAmount}`;
      newPostings.push(newPosting);
    }

    const newText = newPostings.join('\n');

    const edit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.replace(
            Range.create(postingInfo.line, 0, postingInfo.line, originalLine.length),
            newText
          )
        ]
      }
    };

    const action: CodeAction = {
      title: `Split posting into ${parts} equal parts`,
      kind: CodeActionKind.Refactor,
      edit
    };

    return action;
  }

  /**
   * Split an amount into N equal parts
   */
  private splitAmountEqually(
    amount: { quantity: number; commodity: string },
    parts: number
  ): Array<{ quantity: number; commodity: string }> {
    // Calculate base amount by dividing and rounding to 2 decimal places
    const baseAmount = Math.round((amount.quantity / parts) * 100) / 100;

    const result: Array<{ quantity: number; commodity: string }> = [];
    let runningTotal = 0;

    for (let i = 0; i < parts; i++) {
      if (i === parts - 1) {
        // Last part: use the difference to ensure exact sum
        const quantity = Math.round((amount.quantity - runningTotal) * 100) / 100;
        result.push({
          quantity,
          commodity: amount.commodity
        });
      } else {
        // Use base amount for all but last part
        result.push({
          quantity: baseAmount,
          commodity: amount.commodity
        });
        runningTotal += baseAmount;
      }
    }

    return result;
  }

}

export const codeActionProvider = new CodeActionProvider();
