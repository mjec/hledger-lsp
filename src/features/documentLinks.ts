/**
 * Document links provider for hledger journal files
 *
 * Provides clickable links for:
 * - Include directive paths
 */

import { DocumentLink } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument } from '../types';
import { resolveIncludePath } from '../utils/uri';
import { URI } from 'vscode-uri';

export class DocumentLinksProvider {
  /**
   * Provide document links for a document
   */
  provideDocumentLinks(document: TextDocument, parsedDoc: ParsedDocument): DocumentLink[] {
    const links: DocumentLink[] = [];
    const lines = document.getText().split('\n');
    const documentUri: URI = URI.parse(document.uri);

    // Create links for each include directive
    for (const directive of parsedDoc.directives) {
      if (directive.type === 'include' && directive.line !== undefined) {
        const line = lines[directive.line];
        if (!line) continue;

        // Find the include path in the line
        const includeKeyword = 'include';
        const keywordIndex = line.indexOf(includeKeyword);
        if (keywordIndex === -1) continue;

        // The path starts after 'include ' (with space)
        const pathStart = keywordIndex + includeKeyword.length;
        // Skip whitespace after 'include'
        let actualPathStart = pathStart;
        while (actualPathStart < line.length && /\s/.test(line[actualPathStart])) {
          actualPathStart++;
        }

        // Find the end of the path (end of line or start of comment)
        let pathEnd = actualPathStart;
        while (pathEnd < line.length) {
          const char = line[pathEnd];
          if (char === ';' || char === '#') {
            break;
          }
          pathEnd++;
        }

        // Trim trailing whitespace
        while (pathEnd > actualPathStart && /\s/.test(line[pathEnd - 1])) {
          pathEnd--;
        }

        const includePath = line.substring(actualPathStart, pathEnd).trim();
        if (!includePath) continue;

        // Resolve the include path to a full URI
        const resolvedUri = resolveIncludePath(includePath, documentUri);

        links.push({
          range: {
            start: { line: directive.line, character: actualPathStart },
            end: { line: directive.line, character: pathEnd }
          },
          target: resolvedUri.toString()
        });
      }
    }

    return links;
  }
}

export const documentLinksProvider = new DocumentLinksProvider();
