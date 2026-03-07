import { Location, Range, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument } from '../types';
import { getTokenAtPosition } from '../utils/getToken';

export class DefinitionProvider {
  /**
   * Provide a definition location for the token at the given position.
   * Accepts `parsed` produced by server's parser (follows includes, uses fileReader).
   */
  provideDefinition(document: TextDocument, line: number, character: number, parsed: ParsedDocument): Location | null {
    // Get token at position (reuse simple logic from hover)
    const fullLine = document.getText({ start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } });
    const token = getTokenAtPosition(fullLine, character, /\s|;|#/);
    if (!token) return null;

    // Search accounts
    const account = parsed.accounts.get(token);
    if (account && account.sourceUri) {
      const lineNum = account.line ?? 0;
      return Location.create(account.sourceUri.toString(), Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    // Search payees
    const payee = parsed.payees.get(token);
    if (payee && payee.sourceUri) {
      const lineNum = payee.line ?? 0;
      return Location.create(payee.sourceUri.toString(), Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    // Search commodities
    const commodity = parsed.commodities.get(token) || Array.from(parsed.commodities.values()).find(c => c.format?.symbol === token);
    if (commodity && commodity.sourceUri) {
      const lineNum = commodity.line ?? 0;
      return Location.create(commodity.sourceUri.toString(), Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    // Search tags
    const tag = parsed.tags.get(token);
    if (tag && tag.sourceUri) {
      const lineNum = tag.line ?? 0;
      return Location.create(tag.sourceUri.toString(), Range.create(Position.create(lineNum, 0), Position.create(lineNum, 0)));
    }

    return null;
  }
}

export const definitionProvider = new DefinitionProvider();
