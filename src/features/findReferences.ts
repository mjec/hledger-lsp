/**
 * Find references provider for hledger language server
 *
 * Finds all occurrences of accounts, payees, commodities, and tags
 * across the journal file and its includes.
 */

import { Location, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, FileReader } from '../types';
import { URI } from 'vscode-uri';
import { toFilePath } from '../utils/uri';
import * as fs from 'fs';

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
    const item = this.getItemAtCursor(document, position, parsed);
    if (!item) {
      return null;
    }

    // Find all references across all files
    const locations: Location[] = [];

    // Find references based on item type
    switch (item.type) {
      case 'account':
        locations.push(...this.findAccountReferences(parsed, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null).map(r => Location.create(document.uri, r)));
        break;
      case 'payee':
        locations.push(...this.findPayeeReferences(parsed, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null).map(r => Location.create(document.uri, r)));
        break;
      case 'commodity':
        locations.push(...this.findCommodityReferences(parsed, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null).map(r => Location.create(document.uri, r)));
        break;
      case 'tag':
        locations.push(...this.findTagReferences(parsed, item.name, URI.parse(document.uri), (uri) => uri.toString() === document.uri ? document : null).map(r => Location.create(document.uri, r)));
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
    // Get the item at cursor
    const item = this.getItemAtCursor(document, position, parsed);
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
          ranges = this.findAccountReferences(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'payee':
          ranges = this.findPayeeReferences(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'commodity':
          ranges = this.findCommodityReferences(parsedDoc, item.name, fileUri, fileReader);
          break;
        case 'tag':
          ranges = this.findTagReferences(parsedDoc, item.name, fileUri, fileReader);
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
   * Find all account references in parsed document
   */
  public findAccountReferences(
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
  public findPayeeReferences(
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
  public findCommodityReferences(
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
  public findTagReferences(
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
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const findReferencesProvider = new FindReferencesProvider();
