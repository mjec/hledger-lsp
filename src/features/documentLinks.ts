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
import { getIncludePathRange } from '../utils/includeRange';
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

        const includeRange = getIncludePathRange(line, directive.line);
        if (!includeRange) continue;

        // Resolve the include path to a full URI
        const resolvedUri = resolveIncludePath(includeRange.path, documentUri);

        links.push({
          range: includeRange.range,
          target: resolvedUri.toString()
        });
      }
    }

    return links;
  }
}

export const documentLinksProvider = new DocumentLinksProvider();
