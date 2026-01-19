
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HoverProvider } from '../../src/features/hover';
import { HledgerParser } from '../../src/parser/index';

describe('HoverProvider Accounts with Spaces', () => {
  let hoverProvider: HoverProvider;
  let parser: HledgerParser;

  beforeEach(() => {
    hoverProvider = new HoverProvider();
    parser = new HledgerParser();
  });

  it('should provide full hover info for account with spaces', () => {
    const text = `
2023-01-01 Spaces Test
    Assets:Bank Account    -100 USD
    Expenses:Credit Card
`;
    const document = TextDocument.create('file:///spaces.journal', 'hledger', 1, text);
    const parsed = parser.parse(document);

    expect(parsed.accounts.has('Expenses:Credit Card')).toBe(true);
    expect(parsed.accounts.has('Assets:Bank Account')).toBe(true);

    // Hover over "Credit" in "Expenses:Credit Card"
    // Line 3. "    Expenses:Credit Card"
    // Indent 4. "Expenses" start 4. : is 12. "Credit" starts 13.
    const hover = hoverProvider.provideHover(document, 3, 14, parsed);

    const contents = (hover?.contents as any).value;
    // If it extracted "Credit", it won't match "Expenses:Credit Card"
    // If it extracted "Expenses:Credit", it won't match "Expenses:Credit Card"

    expect(contents).toContain('Expenses:Credit Card');
    expect(contents).toContain('**Usage:**');
  });

  it('should provide full hover info for account with spaces when hovering the first part', () => {
    const text = `
2023-01-01 Spaces Test
    Expenses:Credit Card    10 USD
`;
    const document = TextDocument.create('file:///spaces2.journal', 'hledger', 1, text);
    const parsed = parser.parse(document);

    // Hover over "Expenses"
    const hover = hoverProvider.provideHover(document, 2, 6, parsed);
    const contents = (hover?.contents as any).value;
    expect(contents).toContain('Expenses:Credit Card');
  });
});
