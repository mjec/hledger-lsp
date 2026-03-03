/**
 * Shared utility for extracting include directive path ranges from line text.
 * Used by documentLinks and callHierarchy features.
 */

import { Range } from 'vscode-languageserver/node';

export interface IncludeDirectiveRange {
  path: string;
  range: Range;
}

/**
 * Extract the include path and its character range from a line of text.
 * Returns null if the line doesn't contain an include directive or the path is empty.
 *
 * @param lineText - The full text of the line
 * @param lineNumber - The 0-based line number
 */
export function getIncludePathRange(lineText: string, lineNumber: number): IncludeDirectiveRange | null {
  const includeKeyword = 'include';
  const keywordIndex = lineText.indexOf(includeKeyword);
  if (keywordIndex === -1) return null;

  // The path starts after 'include' (with space)
  const pathStart = keywordIndex + includeKeyword.length;
  // Skip whitespace after 'include'
  let actualPathStart = pathStart;
  while (actualPathStart < lineText.length && /\s/.test(lineText[actualPathStart])) {
    actualPathStart++;
  }

  // Find the end of the path (end of line or start of comment)
  let pathEnd = actualPathStart;
  while (pathEnd < lineText.length) {
    const char = lineText[pathEnd];
    if (char === ';' || char === '#') {
      break;
    }
    pathEnd++;
  }

  // Trim trailing whitespace
  while (pathEnd > actualPathStart && /\s/.test(lineText[pathEnd - 1])) {
    pathEnd--;
  }

  const includePath = lineText.substring(actualPathStart, pathEnd).trim();
  if (!includePath) return null;

  return {
    path: includePath,
    range: {
      start: { line: lineNumber, character: actualPathStart },
      end: { line: lineNumber, character: pathEnd }
    }
  };
}
