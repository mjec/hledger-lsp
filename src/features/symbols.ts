/**
 * Symbol providers for document outline and workspace-wide search
 */

import { DocumentSymbol, SymbolInformation, SymbolKind, Range, Location } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { ParsedDocument, Transaction, Directive } from '../types';
import { formatAmount } from '../utils/amountFormatter';


export class DocumentSymbolProvider {
  /**
  /**
   * Provide document symbols for outline view
   * Returns hierarchical symbols representing the structure of the document
   */
  provideDocumentSymbols(document: TextDocument, parsedDoc: ParsedDocument): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    const lines = document.getText().split('\n');
    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

    // Add directive symbols
    for (const directive of parsedDoc.directives) {
      // Only include directives from the current document
      if (directive.sourceUri && directive.sourceUri.toString() !== documentUri) {
        continue;
      }

      const line = directive.line;
      if (line !== undefined && line < lines.length) {
        const range = Range.create(line, 0, line, lines[line].length);
        const kind = this.getDirectiveSymbolKind(directive.type);

        symbols.push({
          name: `${directive.type} ${directive.value}`,
          detail: directive.comment || undefined,
          kind,
          range,
          selectionRange: range
        });
      }
    }

    // Add transaction symbols
    for (const transaction of parsedDoc.transactions) {
      // Only include transactions from the current document
      if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
        continue;
      }

      const line = transaction.line;
      if (line !== undefined && line < lines.length) {
        // Calculate the range of the entire transaction (including postings)
        const endLine = this.findTransactionEndLine(lines, line);
        const range = Range.create(line, 0, endLine, lines[endLine].length);
        const selectionRange = Range.create(line, 0, line, lines[line].length);

        const statusIcon = transaction.status === 'cleared' ? '* ' :
          transaction.status === 'pending' ? '! ' : '';
        const name = `${transaction.date} ${statusIcon}${transaction.description}`;

        // Create child symbols for postings
        const children: DocumentSymbol[] = [];
        for (const posting of transaction.postings) {
          const postingLine = posting.line;
          if (postingLine !== undefined && postingLine < lines.length) {
            const postingRange = Range.create(postingLine, 0, postingLine, lines[postingLine].length);
            const amountStr = posting.amount
              ? ` ${formatAmount(posting.amount.quantity, posting.amount.commodity, parsedDoc)}`
              : '';

            children.push({
              name: posting.account + amountStr,
              kind: SymbolKind.Field,
              range: postingRange,
              selectionRange: postingRange
            });
          }
        }

        symbols.push({
          name,
          detail: transaction.code || undefined,
          kind: SymbolKind.Event,
          range,
          selectionRange,
          children: children.length > 0 ? children : undefined
        });
      }
    }

    return symbols;
  }

  /**
   * Find the end line of a transaction (last posting or comment)
   */
  private findTransactionEndLine(lines: string[], startLine: number): number {
    let endLine = startLine;

    // Move to the next line and keep going while we have indented lines (postings/comments)
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];

      // Empty line or unindented line marks the end
      if (line.trim() === '' || !line.match(/^\s/)) {
        break;
      }

      endLine = i;
    }

    return endLine;
  }

  /**
   * Get the appropriate SymbolKind for a directive type
   */
  private getDirectiveSymbolKind(directiveType: string): SymbolKind {
    switch (directiveType) {
      case 'account':
        return SymbolKind.Class;
      case 'commodity':
        return SymbolKind.Number;
      case 'payee':
        return SymbolKind.String;
      case 'tag':
        return SymbolKind.Property;
      case 'include':
        return SymbolKind.File;
      case 'alias':
        return SymbolKind.Variable;
      default:
        return SymbolKind.Constant;
    }
  }
}

export class WorkspaceSymbolProvider {
  /**
   * Provide workspace-wide symbol search
   * Returns flat list of symbols matching the query across all files
   */
  provideWorkspaceSymbols(query: string, parsedDoc: ParsedDocument): SymbolInformation[] {
    const symbols: SymbolInformation[] = [];
    const lowerQuery = query.toLowerCase();

    // Search accounts
    for (const account of parsedDoc.accounts.values()) {
      if (account.name.toLowerCase().includes(lowerQuery)) {
        const uri = account.sourceUri || '';
        const line = account.line ?? 0;
        const location = Location.create(uri.toString(), Range.create(line, 0, line, 0));

        symbols.push({
          name: account.name,
          kind: SymbolKind.Class,
          location,
          containerName: account.declared ? 'Declared Account' : 'Account'
        });
      }
    }

    // Search payees
    for (const payee of parsedDoc.payees.values()) {
      if (payee.name.toLowerCase().includes(lowerQuery)) {
        const uri = payee.sourceUri || '';
        const line = payee.line ?? 0;
        const location = Location.create(uri.toString(), Range.create(line, 0, line, 0));

        symbols.push({
          name: payee.name,
          kind: SymbolKind.String,
          location,
          containerName: payee.declared ? 'Declared Payee' : 'Payee'
        });
      }
    }

    // Search commodities
    for (const commodity of parsedDoc.commodities.values()) {
      if (commodity.name.toLowerCase().includes(lowerQuery)) {
        const uri = commodity.sourceUri || '';
        const line = commodity.line ?? 0;
        const location = Location.create(uri.toString(), Range.create(line, 0, line, 0));

        symbols.push({
          name: commodity.name,
          kind: SymbolKind.Number,
          location,
          containerName: commodity.declared ? 'Declared Commodity' : 'Commodity'
        });
      }
    }

    // Search tags
    for (const tag of parsedDoc.tags.values()) {
      if (tag.name.toLowerCase().includes(lowerQuery)) {
        const uri = tag.sourceUri || '';
        const line = tag.line ?? 0;
        const location = Location.create(uri.toString(), Range.create(line, 0, line, 0));

        symbols.push({
          name: tag.name,
          kind: SymbolKind.Property,
          location,
          containerName: tag.declared ? 'Declared Tag' : 'Tag'
        });
      }
    }

    // Search transactions by description
    for (const transaction of parsedDoc.transactions) {
      if (transaction.description.toLowerCase().includes(lowerQuery)) {
        const uri = transaction.sourceUri || '';
        const line = transaction.line ?? 0;
        const location = Location.create(uri.toString(), Range.create(line, 0, line, 0));

        const statusIcon = transaction.status === 'cleared' ? '* ' :
          transaction.status === 'pending' ? '! ' : '';

        symbols.push({
          name: `${transaction.date} ${statusIcon}${transaction.description}`,
          kind: SymbolKind.Event,
          location,
          containerName: 'Transaction'
        });
      }
    }

    return symbols;
  }
}

export const documentSymbolProvider = new DocumentSymbolProvider();
export const workspaceSymbolProvider = new WorkspaceSymbolProvider();
