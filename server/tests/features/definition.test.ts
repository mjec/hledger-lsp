import { TextDocument } from 'vscode-languageserver-textdocument';
import { definitionProvider } from '../../src/features/definition';
import { ParsedDocument } from '../../src/types';

describe('definition provider', () => {
  test('returns account declaration location in same file', () => {
    const uri = 'file://test.journal';
    const content = 'account Assets:Bank\n\n2023-01-01 Payee\n    Assets:Bank  $100';
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed: ParsedDocument = {
      transactions: [],
      accounts: new Map([['Assets:Bank', { name: 'Assets:Bank', declared: true, sourceUri: uri, line: 0 }]]),
      directives: [],
      commodities: new Map(),
      payees: new Map(),
      tags: new Map()
    };

    // position somewhere on 'Assets:Bank' on the posting line (line 3, char ~4)
    const loc = definitionProvider.provideDefinition(doc, 3, 6, parsed);
    expect(loc).not.toBeNull();
    expect(loc?.uri).toBe(uri);
    expect(loc?.range.start.line).toBe(0);
  });

  test('returns payee declaration location from included file', () => {
    const uri = 'file://main.journal';
    const includedUri = 'file://included.journal';
    const content = '2025-02-02 PayeeName\n    Expenses:Food  $20';
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed: ParsedDocument = {
      transactions: [],
      accounts: new Map(),
      directives: [],
      commodities: new Map(),
      payees: new Map([['PayeeName', { name: 'PayeeName', declared: true, sourceUri: includedUri, line: 5 }]]),
      tags: new Map()
    };

    const loc = definitionProvider.provideDefinition(doc, 0, 11, parsed); // over 'PayeeName'
    expect(loc).not.toBeNull();
    expect(loc?.uri).toBe(includedUri);
    expect(loc?.range.start.line).toBe(5);
  });

  test('returns null when no declaration exists', () => {
    const uri = 'file://no.journal';
    const content = '2025-03-03 UnknownPayee\n    Assets:Cash  $5';
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed: ParsedDocument = {
      transactions: [],
      accounts: new Map(),
      directives: [],
      commodities: new Map(),
      payees: new Map(),
      tags: new Map()
    };

    const loc = definitionProvider.provideDefinition(doc, 0, 11, parsed);
    expect(loc).toBeNull();
  });

  test('returns first declaration when multiple declarations exist', () => {
    const uri = 'file://multi.journal';
    const content = '2025-04-04 MultiPayee\n    Expenses:Misc  $10';
    const doc = TextDocument.create(uri, 'hledger', 1, content);

    const parsed: ParsedDocument = {
      transactions: [],
      accounts: new Map(),
      directives: [],
      commodities: new Map(),
      payees: new Map([
        ['MultiPayee', { name: 'MultiPayee', declared: true, sourceUri: 'file://a.journal', line: 2 }]
      ]),
      tags: new Map()
    };

    const loc = definitionProvider.provideDefinition(doc, 0, 12, parsed);
    expect(loc).not.toBeNull();
    expect(loc?.uri).toBe('file://a.journal');
    expect(loc?.range.start.line).toBe(2);
  });
});
