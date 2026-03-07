/**
 * Call Hierarchy provider for hledger journal files.
 *
 * Maps include relationships onto LSP Call Hierarchy:
 * - "Incoming calls" = files that include this file
 * - "Outgoing calls" = files this file includes
 *
 * This gives users built-in editor navigation (VS Code Call Hierarchy pane,
 * Neovim LSP call hierarchy pickers) with no client-side code needed.
 */

import {
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  SymbolKind,
  Range,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import * as path from 'path';
import { ParsedDocument, FileReader } from '../types';
import { WorkspaceManager } from '../server/workspace';
import { isFromDocument } from '../utils/index';
import { getIncludePathRange } from '../utils/includeRange';
import { toFilePath } from '../utils/uri';

/**
 * Create a CallHierarchyItem for a file URI.
 */
function createFileItem(fileUri: URI): CallHierarchyItem {
  const filePath = toFilePath(fileUri);
  const name = path.basename(filePath);
  // Use the full range of the file (line 0, char 0) since we represent the whole file
  const wholeFileRange: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };

  return {
    name,
    kind: SymbolKind.File,
    uri: fileUri.toString(),
    detail: filePath,
    range: wholeFileRange,
    selectionRange: wholeFileRange,
  };
}

export class CallHierarchyProvider {
  /**
   * Prepare call hierarchy items at the given position.
   *
   * - If the cursor is on an include directive line: return item(s) for the included file(s)
   * - Otherwise: return a CallHierarchyItem for the current file
   * - Returns null if the file isn't in the workspace
   */
  prepareCallHierarchy(
    document: TextDocument,
    line: number,
    _character: number,
    parsedDoc: ParsedDocument,
    workspaceManager: WorkspaceManager,
  ): CallHierarchyItem[] | null {
    const documentUri = URI.parse(document.uri);

    if (!workspaceManager.isKnownFile(documentUri)) {
      return null;
    }

    const lines = document.getText().split('\n');
    const lineText = lines[line];

    // Check if we're on an include directive line
    if (lineText !== undefined) {
      const includeDirectives = parsedDoc.directives.filter(
        d => d.type === 'include' && d.line === line && isFromDocument(d, documentUri.toString())
      );

      if (includeDirectives.length > 0) {
        // Get the resolved targets for these include directives
        const allDirectives = workspaceManager.getIncludeDirectivesForFile(documentUri);
        const items: CallHierarchyItem[] = [];

        for (const directive of includeDirectives) {
          const matched = allDirectives.find(d => d.directive.line === directive.line);
          if (matched) {
            for (const targetUri of matched.targets) {
              items.push(createFileItem(targetUri));
            }
          }
        }

        if (items.length > 0) {
          return items;
        }
      }
    }

    // Default: return the current file
    return [createFileItem(documentUri)];
  }

  /**
   * Resolve incoming calls (files that include the given item's file).
   */
  resolveIncomingCalls(
    item: CallHierarchyItem,
    workspaceManager: WorkspaceManager,
    fileReader: FileReader,
  ): CallHierarchyIncomingCall[] | null {
    const itemUri = URI.parse(item.uri);
    const parentUris = workspaceManager.getFilesIncluding(itemUri);

    if (parentUris.length === 0) {
      return [];
    }

    const result: CallHierarchyIncomingCall[] = [];

    for (const parentUri of parentUris) {
      const parentDoc = fileReader(parentUri);
      if (!parentDoc) continue;

      const parentLines = parentDoc.getText().split('\n');
      const fromRanges: Range[] = [];

      // Find include directive lines in parent that point to this file
      const parentDirectives = workspaceManager.getIncludeDirectivesForFile(parentUri);
      for (const { directive, targets } of parentDirectives) {
        const pointsToItem = targets.some(t => t.toString() === itemUri.toString());
        if (pointsToItem && directive.line !== undefined) {
          const lineText = parentLines[directive.line];
          if (lineText) {
            const includeRange = getIncludePathRange(lineText, directive.line);
            if (includeRange) {
              fromRanges.push(includeRange.range);
            }
          }
        }
      }

      if (fromRanges.length > 0) {
        result.push({
          from: createFileItem(parentUri),
          fromRanges,
        });
      }
    }

    return result;
  }

  /**
   * Resolve outgoing calls (files that the given item's file includes).
   */
  resolveOutgoingCalls(
    item: CallHierarchyItem,
    workspaceManager: WorkspaceManager,
    fileReader: FileReader,
  ): CallHierarchyOutgoingCall[] | null {
    const sourceUri = URI.parse(item.uri);
    const directives = workspaceManager.getIncludeDirectivesForFile(sourceUri);

    if (directives.length === 0) {
      return [];
    }

    const sourceDoc = fileReader(sourceUri);
    if (!sourceDoc) return [];

    const sourceLines = sourceDoc.getText().split('\n');

    // Group by target URI since glob includes can resolve to multiple files with same directive range
    const targetMap = new Map<string, { uri: URI; fromRanges: Range[] }>();

    for (const { directive, targets } of directives) {
      if (directive.line === undefined) continue;

      const lineText = sourceLines[directive.line];
      if (!lineText) continue;

      const includeRange = getIncludePathRange(lineText, directive.line);
      if (!includeRange) continue;

      for (const targetUri of targets) {
        const key = targetUri.toString();
        let entry = targetMap.get(key);
        if (!entry) {
          entry = { uri: targetUri, fromRanges: [] };
          targetMap.set(key, entry);
        }
        // Avoid duplicate ranges (same directive pointing to same target)
        const alreadyHas = entry.fromRanges.some(
          r => r.start.line === includeRange.range.start.line &&
               r.start.character === includeRange.range.start.character
        );
        if (!alreadyHas) {
          entry.fromRanges.push(includeRange.range);
        }
      }
    }

    const result: CallHierarchyOutgoingCall[] = [];
    for (const { uri, fromRanges } of targetMap.values()) {
      result.push({
        to: createFileItem(uri),
        fromRanges,
      });
    }

    return result;
  }
}

export const callHierarchyProvider = new CallHierarchyProvider();
