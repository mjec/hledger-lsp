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
import { ParsedDocument, FileReader } from '../types';
import { formatAmount } from '../utils/amountFormatter';
import { toFilePath } from '../utils/uri';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import { findReferencesProvider } from './findReferences';

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
        ranges = findReferencesProvider.findAccountReferences(parsedDoc, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null);
        break;
      case 'payee':
        ranges = findReferencesProvider.findPayeeReferences(parsedDoc, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null);
        break;
      case 'commodity':
        ranges = findReferencesProvider.findCommodityReferences(parsedDoc, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null);
        break;
      case 'tag':
        ranges = findReferencesProvider.findTagReferences(parsedDoc, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null);
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
   * Create workspace edit to rename an item across all workspace files
   * Uses parsed documents for accurate reference finding
   */
  public createWorkspaceRenameEdit(
    item: { type: 'account' | 'payee' | 'commodity' | 'tag'; name: string },
    newName: string,
    fileUris: URI[],
    parser: any, // HledgerParser
    fileReader?: FileReader
  ): WorkspaceEdit {
    const changes: { [uri: string]: TextEdit[] } = {};

    // Parse all files once (parser will handle caching)
    const parsedDocs = new Map<string, ParsedDocument>();
    for (const fileUri of fileUris) {
      try {
        // Get the TextDocument for this URI
        let doc: TextDocument | null = null;
        if (fileReader) {
          doc = fileReader(fileUri);
        }

        if (!doc) {
          // Fallback to reading from disk
          const filePath = toFilePath(fileUri);
          const content = fs.readFileSync(filePath, 'utf8');
          doc = TextDocument.create(fileUri.toString(), 'hledger', 1, content);
        }

        const parsed = parser.parse(doc, { fileReader });
        parsedDocs.set(fileUri.toString(), parsed);
      } catch (error) {
        // Skip files that can't be parsed
        continue;
      }
    }

    // Find references in each parsed file
    for (const [uriString, parsedDoc] of parsedDocs) {
      const fileUri = URI.parse(uriString);
      let ranges: Range[] = [];

      // Find references in this file based on item type
      switch (item.type) {
        case 'account':
          ranges = findReferencesProvider.findAccountReferences(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'payee':
          ranges = findReferencesProvider.findPayeeReferences(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'commodity':
          ranges = findReferencesProvider.findCommodityReferences(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'tag':
          ranges = findReferencesProvider.findTagReferences(parsedDoc, item.name, fileUri, fileReader);
          break;
      }

      if (ranges.length > 0) {
        const edits: TextEdit[] = ranges.map(range => TextEdit.replace(range, newName));
        changes[uriString] = edits;
      }
    }

    return { changes };
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
