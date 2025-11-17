/**
 * Find references provider for hledger language server
 *
 * Finds all occurrences of accounts, payees, commodities, and tags
 * across the journal file and its includes.
 */

import { Location, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument } from '../types';
import { codeActionProvider } from './codeActions';

export class FindReferencesProvider {
  /**
   * Find all references to the symbol at the given position
   */
  findReferences(
    document: TextDocument,
    position: Position,
    parsed: ParsedDocument,
    includeDeclaration: boolean
  ): Location[] | null {
    // Get the item at cursor
    const item = codeActionProvider.getItemAtCursor(document, position, parsed);
    if (!item) {
      return null;
    }

    // Find all references across all files
    const locations: Location[] = [];

    // Build a map of URI -> document content for all files
    const fileContents = new Map<string, string>();
    fileContents.set(document.uri, document.getText());

    // We need to process the main document and any included files
    // For now, we'll only search the current document since we don't have
    // access to other file contents in this provider
    // TODO: This could be extended to search included files if we have access to them

    // Find references based on item type
    switch (item.type) {
      case 'account':
        locations.push(...this.findAccountReferences(document, item.name, parsed));
        break;
      case 'payee':
        locations.push(...this.findPayeeReferences(document, item.name, parsed));
        break;
      case 'commodity':
        locations.push(...this.findCommodityReferences(document, item.name, parsed));
        break;
      case 'tag':
        locations.push(...this.findTagReferences(document, item.name, parsed));
        break;
    }

    return locations;
  }

  /**
   * Find all references to an account
   */
  private findAccountReferences(
    document: TextDocument,
    accountName: string,
    parsed: ParsedDocument
  ): Location[] {
    const ranges = codeActionProvider.findAccountReferences(document, accountName, parsed);
    return ranges.map(range => Location.create(document.uri, range));
  }

  /**
   * Find all references to a payee
   */
  private findPayeeReferences(
    document: TextDocument,
    payeeName: string,
    parsed: ParsedDocument
  ): Location[] {
    const ranges = codeActionProvider.findPayeeReferences(document, payeeName, parsed);
    return ranges.map(range => Location.create(document.uri, range));
  }

  /**
   * Find all references to a commodity
   */
  private findCommodityReferences(
    document: TextDocument,
    commodityName: string,
    parsed: ParsedDocument
  ): Location[] {
    const ranges = codeActionProvider.findCommodityReferences(document, commodityName, parsed);
    return ranges.map(range => Location.create(document.uri, range));
  }

  /**
   * Find all references to a tag
   */
  private findTagReferences(
    document: TextDocument,
    tagName: string,
    parsed: ParsedDocument
  ): Location[] {
    const ranges = codeActionProvider.findTagReferences(document, tagName, parsed);
    return ranges.map(range => Location.create(document.uri, range));
  }
}

export const findReferencesProvider = new FindReferencesProvider();
