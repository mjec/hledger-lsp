/**
 * Find references provider for hledger language server
 *
 * Finds all occurrences of accounts, payees, commodities, and tags
 * across the journal file and its includes.
 */

import { Location, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, FileReader } from '../types';
import { codeActionProvider } from './codeActions';
import { URI } from 'vscode-uri';

export class FindReferencesProvider {
  /**
   * Find all references to the symbol at the given position
   */
  findReferences(
    document: TextDocument,
    position: Position,
    parsed: ParsedDocument,
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
   * Find all references to the symbol at the given position across workspace files
   * Uses parsed documents for accurate reference finding
   */
  findWorkspaceReferences(
    document: TextDocument,
    position: Position,
    parsed: ParsedDocument,
    fileUris: URI[],
    parser: any, // HledgerParser
    fileReader?: FileReader
  ): Location[] | null {
    // Get the item at cursor
    const item = codeActionProvider.getItemAtCursor(document, position, parsed);
    if (!item) {
      return null;
    }

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
          const fs = require('fs');
          const { toFilePath } = require('../utils/uri');
          const filePath = toFilePath(fileUri);
          const content = fs.readFileSync(filePath, 'utf8');
          doc = TextDocument.create(fileUri.toString(), 'hledger', 1, content);
        }

        const parsedFile = parser.parse(doc, { fileReader });
        parsedDocs.set(fileUri.toString(), parsedFile);
      } catch (error) {
        // Skip files that can't be parsed
        continue;
      }
    }

    // Find all references across all workspace files
    const locations: Location[] = [];

    for (const [uriString, parsedDoc] of parsedDocs) {
      const fileUri = URI.parse(uriString);
      let ranges: Range[] = [];

      switch (item.type) {
        case 'account':
          ranges = codeActionProvider.findAccountReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'payee':
          ranges = codeActionProvider.findPayeeReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'commodity':
          ranges = codeActionProvider.findCommodityReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'tag':
          ranges = codeActionProvider.findTagReferencesInParsedDoc(parsedDoc, item.name, fileUri, fileReader);
          break;
        default:
          continue;
      }

      if (ranges.length > 0) {
        locations.push(...ranges.map(range => Location.create(uriString, range)));
      }
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
