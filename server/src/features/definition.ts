import { Location, Range, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parser } from '../parser/index';

import { ParsedDocument } from '../types';

export class DefinitionProvider {
  /**
   * Provide a definition location for the token at the given position.
   * Accepts `parsed` produced by server's parser (follows includes, uses fileReader).
   */
  provideDefinition(document: TextDocument, line: number, character: number, parsed: ParsedDocument): Location | null {
    // Get token at position (reuse simple logic from hover)
    const fullLine = document.getText({ start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } });
    const col = Math.min(character, fullLine.length);
    let start = col - 1;
    while (start >= 0) {
      const ch = fullLine[start];
      if (/\s|;|#/.test(ch)) break;
      start--;
    }
    start++;
    let end = col;
    while (end < fullLine.length) {
      const ch = fullLine[end];
      if (/\s|;|#/.test(ch)) break;
      end++;
    }
    const token = fullLine.substring(start, end).trim();
    if (!token) return null;

    // Search accounts
    const account = parsed.accounts.find(a => a.name === token);
    if (account && account.sourceUri) {
      const lineNum = account.line ?? 0;
      return Location.create(account.sourceUri, Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    // Search payees
    const payee = parsed.payees.find(p => p.name === token);
    if (payee && payee.sourceUri) {
      const lineNum = payee.line ?? 0;
      return Location.create(payee.sourceUri, Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    // Search commodities
    const commodity = parsed.commodities.find(c => c.name === token || c.format?.symbol === token);
    if (commodity && commodity.sourceUri) {
      const lineNum = commodity.line ?? 0;
      return Location.create(commodity.sourceUri, Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    // Search tags
    const tag = parsed.tags.find(t => t.name === token);
    if (tag && tag.sourceUri) {
      const lineNum = tag.line ?? 0;
      return Location.create(tag.sourceUri, Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    return null;
  }
}

export const definitionProvider = new DefinitionProvider();
