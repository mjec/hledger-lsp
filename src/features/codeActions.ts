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
import { ParsedDocument, FileReader } from '../types';
import { formatAmount } from '../utils/amountFormatter';
import { toFilePath } from '../utils/uri';
import * as fs from 'fs';

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
          ranges = this.findAccountReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'payee':
          ranges = this.findPayeeReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'commodity':
          ranges = this.findCommodityReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'tag':
          ranges = this.findTagReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
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
   * Find all account references in parsed document
   */
  public findAccountReferencesInParsedDoc(
    parsedDoc: ParsedDocument,
    accountName: string,
    fileUri: URI,
    fileReader?: FileReader
  ): Range[] {
    const ranges: Range[] = [];
    const fileUriString = fileUri.toString();

    // Get file lines for finding character positions
    let lines: string[] | null = null;
    if (fileReader) {
      const doc = fileReader(fileUri);
      if (doc) {
        lines = doc.getText().split('\n');
      }
    }
    if (!lines) {
      // Fallback to reading from disk
      try {
        const filePath = toFilePath(fileUri);
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n');
      } catch (error) {
        return ranges; // Can't read file, return empty
      }
    }

    // Find in directives
    for (const directive of parsedDoc.directives) {
      if (directive.type === 'account' &&
        directive.value === accountName &&
        directive.sourceUri?.toString() === fileUriString &&
        directive.line !== undefined &&
        directive.line < lines.length) {
        const line = lines[directive.line];
        const start = line.indexOf(accountName);
        if (start !== -1) {
          ranges.push(Range.create(
            directive.line,
            start,
            directive.line,
            start + accountName.length
          ));
        }
      }
    }

    // Find in postings
    for (const transaction of parsedDoc.transactions) {
      if (transaction.sourceUri?.toString() !== fileUriString) continue;

      for (const posting of transaction.postings) {
        if (posting.account === accountName &&
          posting.line !== undefined &&
          posting.line < lines.length) {
          const line = lines[posting.line];
          const start = line.indexOf(accountName);
          if (start !== -1) {
            ranges.push(Range.create(
              posting.line,
              start,
              posting.line,
              start + accountName.length
            ));
          }
        }
      }
    }

    return ranges;
  }

  /**
   * Find all payee references in parsed document
   */
  public findPayeeReferencesInParsedDoc(
    parsedDoc: ParsedDocument,
    payeeName: string,
    fileUri: URI,
    fileReader?: FileReader
  ): Range[] {
    const ranges: Range[] = [];
    const fileUriString = fileUri.toString();

    // Get file lines for finding character positions
    let lines: string[] | null = null;
    if (fileReader) {
      const doc = fileReader(fileUri);
      if (doc) {
        lines = doc.getText().split('\n');
      }
    }
    if (!lines) {
      try {
        const filePath = toFilePath(fileUri);
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n');
      } catch (error) {
        return ranges;
      }
    }

    // Find in directives
    for (const directive of parsedDoc.directives) {
      if (directive.type === 'payee' &&
        directive.value === payeeName &&
        directive.sourceUri?.toString() === fileUriString &&
        directive.line !== undefined &&
        directive.line < lines.length) {
        const line = lines[directive.line];
        const start = line.indexOf(payeeName);
        if (start !== -1) {
          ranges.push(Range.create(
            directive.line,
            start,
            directive.line,
            start + payeeName.length
          ));
        }
      }
    }

    // Find in transactions
    for (const transaction of parsedDoc.transactions) {
      if (transaction.sourceUri?.toString() !== fileUriString) continue;

      if (transaction.payee === payeeName &&
        transaction.line !== undefined &&
        transaction.line < lines.length) {
        const line = lines[transaction.line];
        const start = line.indexOf(payeeName);
        if (start !== -1) {
          ranges.push(Range.create(
            transaction.line,
            start,
            transaction.line,
            start + payeeName.length
          ));
        }
      }
    }

    return ranges;
  }

  /**
   * Find all commodity references in parsed document
   */
  public findCommodityReferencesInParsedDoc(
    parsedDoc: ParsedDocument,
    commodityName: string,
    fileUri: URI,
    fileReader?: FileReader
  ): Range[] {
    const ranges: Range[] = [];
    const fileUriString = fileUri.toString();

    // Get file lines for finding character positions
    let lines: string[] | null = null;
    if (fileReader) {
      const doc = fileReader(fileUri);
      if (doc) {
        lines = doc.getText().split('\n');
      }
    }
    if (!lines) {
      try {
        const filePath = toFilePath(fileUri);
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n');
      } catch (error) {
        return ranges;
      }
    }

    // Find in directives
    for (const directive of parsedDoc.directives) {
      if (directive.type === 'commodity' &&
        directive.value.startsWith(commodityName) &&
        directive.sourceUri?.toString() === fileUriString &&
        directive.line !== undefined &&
        directive.line < lines.length) {
        const line = lines[directive.line];
        const start = line.indexOf(commodityName);
        if (start !== -1) {
          ranges.push(Range.create(
            directive.line,
            start,
            directive.line,
            start + commodityName.length
          ));
        }
      }
    }

    // Find in posting amounts
    for (const transaction of parsedDoc.transactions) {
      if (transaction.sourceUri?.toString() !== fileUriString) continue;

      for (const posting of transaction.postings) {
        if (posting.line === undefined || posting.line >= lines.length) continue;

        const line = lines[posting.line];

        // Check amount commodity
        if (posting.amount?.commodity === commodityName) {
          const start = line.indexOf(commodityName);
          if (start !== -1) {
            ranges.push(Range.create(
              posting.line,
              start,
              posting.line,
              start + commodityName.length
            ));
          }
        }

        // Check assertion commodity
        if (posting.assertion?.commodity === commodityName) {
          const assertionStart = line.indexOf('=');
          if (assertionStart !== -1) {
            const start = line.indexOf(commodityName, assertionStart);
            if (start !== -1) {
              ranges.push(Range.create(
                posting.line,
                start,
                posting.line,
                start + commodityName.length
              ));
            }
          }
        }

        // Check cost commodity
        if (posting.cost?.amount?.commodity === commodityName) {
          const costStart = line.indexOf('@');
          if (costStart !== -1) {
            const start = line.indexOf(commodityName, costStart);
            if (start !== -1) {
              ranges.push(Range.create(
                posting.line,
                start,
                posting.line,
                start + commodityName.length
              ));
            }
          }
        }
      }
    }

    return ranges;
  }

  /**
   * Find all tag references in parsed document
   */
  public findTagReferencesInParsedDoc(
    parsedDoc: ParsedDocument,
    tagName: string,
    fileUri: URI,
    fileReader?: FileReader
  ): Range[] {
    const ranges: Range[] = [];
    const fileUriString = fileUri.toString();

    // Get file lines for finding character positions
    let lines: string[] | null = null;
    if (fileReader) {
      const doc = fileReader(fileUri);
      if (doc) {
        lines = doc.getText().split('\n');
      }
    }
    if (!lines) {
      try {
        const filePath = toFilePath(fileUri);
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n');
      } catch (error) {
        return ranges;
      }
    }

    // Find in directives
    for (const directive of parsedDoc.directives) {
      if (directive.type === 'tag' &&
        directive.value === tagName &&
        directive.sourceUri?.toString() === fileUriString &&
        directive.line !== undefined &&
        directive.line < lines.length) {
        const line = lines[directive.line];
        const start = line.indexOf(tagName);
        if (start !== -1) {
          ranges.push(Range.create(
            directive.line,
            start,
            directive.line,
            start + tagName.length
          ));
        }
      }
    }

    // Find in transaction tags
    for (const transaction of parsedDoc.transactions) {
      if (transaction.sourceUri?.toString() !== fileUriString) continue;

      if (transaction.tags && tagName in transaction.tags &&
        transaction.line !== undefined &&
        transaction.line < lines.length) {
        const line = lines[transaction.line];
        const tagPattern = new RegExp(`\\b${this.escapeRegExp(tagName)}:`, 'g');
        let match;
        while ((match = tagPattern.exec(line)) !== null) {
          ranges.push(Range.create(
            transaction.line,
            match.index,
            transaction.line,
            match.index + tagName.length
          ));
        }
      }

      // Find in posting tags
      for (const posting of transaction.postings) {
        if (posting.tags && tagName in posting.tags &&
          posting.line !== undefined &&
          posting.line < lines.length) {
          const line = lines[posting.line];
          const tagPattern = new RegExp(`\\b${this.escapeRegExp(tagName)}:`, 'g');
          let match;
          while ((match = tagPattern.exec(line)) !== null) {
            ranges.push(Range.create(
              posting.line,
              match.index,
              posting.line,
              match.index + tagName.length
            ));
          }
        }
      }
    }

    return ranges;
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
