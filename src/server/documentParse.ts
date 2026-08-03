/**
 * Choosing the parse a feature should see for a document.
 *
 * Both the LSP server and `hledger-lsp --format` must resolve a document the same
 * way, or the CLI formats against a different view of the journal than the editor
 * does (see issue #17): commodity styles, account declarations and prices all
 * live in whichever files the workspace root pulls in, not necessarily in the
 * file being formatted.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../parser/index';
import { ParsedDocument } from '../types';
import { WorkspaceManager } from './workspace';

/**
 * Parse `document` with as much workspace context as is available.
 *
 * - Part of the workspace include tree → the merged workspace parse.
 * - Known to the manager but outside the root's tree → parse from this file,
 *   following its own includes.
 * - No workspace manager → single-file parse.
 */
export function parseWithWorkspace(
  document: TextDocument,
  workspaceManager: WorkspaceManager | null,
  parser: HledgerParser
): ParsedDocument {
  if (workspaceManager) {
    const documentUri = URI.parse(document.uri);

    if (workspaceManager.getRootForFile(documentUri)) {
      const parsed = workspaceManager.parseWorkspace();
      if (parsed) {
        return parsed;
      }
    }

    return workspaceManager.parseFromFile(documentUri);
  }

  return parser.parse(document);
}
