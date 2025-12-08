
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HoverProvider } from '../../src/features/hover';
import { HledgerParser } from '../../src/parser/index';
import { defaultFileReader } from '../../src/utils/uri';

// We need a real parser to check if the last posting is actually captured in the Map
describe('HoverProvider Last Posting', () => {
    let hoverProvider: HoverProvider;
    let parser: HledgerParser;

    beforeEach(() => {
        hoverProvider = new HoverProvider();
        parser = new HledgerParser();
    });

    it('should provide full hover info for the last posting in a transaction', async () => {
        const text = `
2023-01-01 Last Posting Test
    Assets:Bank        -100 USD
    Expenses:Food
`;
        const document = TextDocument.create('file:///test.journal', 'hledger', 1, text);

        // Parse it using the real parser logic to populate maps
        const parsed = parser.parse(document, { baseUri: 'file:///test.journal', fileReader: defaultFileReader });

        // "Expenses:Food" is on line 3, indented.
        // Line indices: 0=empty, 1=date, 2=posting1, 3=posting2

        // Check if map has it
        expect(parsed.accounts.has('Expenses:Food')).toBe(true);
        expect(parsed.accounts.get('Expenses:Food')?.declared).toBe(false); // inferred

        // Usage count check?
        // Provide hover at "Food" position (e.g. char 15)
        const hover = hoverProvider.provideHover(document, 3, 15, parsed);

        const contents = (hover?.contents as any).value;
        // Should NOT be the basic one
        // Basic: "**Account**\n\n`Expenses:Food`"
        // Full: has usage count

        expect(contents).toContain('**Usage:**');
        expect(contents).toContain('**Status:** Undeclared');
    });

    it('should provide full hover info for posting indented with TABS', async () => {
        const text = `
2023-01-01 Tab Indentation
\tAssets:Bank\t-100 USD
\tExpenses:Food
`;
        const document = TextDocument.create('file:///tabs.journal', 'hledger', 1, text);
        const parsed = parser.parse(document, { baseUri: 'file:///tabs.journal', fileReader: defaultFileReader });

        expect(parsed.accounts.has('Expenses:Food')).toBe(true);
        expect(parsed.accounts.get('Expenses:Food')?.declared).toBe(false);

        // Hover over "Expenses:Food" (line 3)
        // Check finding token at position (tabs handling in token extraction?)
        // HoverProvider.getTokenAtPosition splits on \s. \t is \s.
        // So "Expenses:Food" should be found.

        const hover = hoverProvider.provideHover(document, 3, 2, parsed); // index 2 (after tab)
        const contents = (hover?.contents as any).value;
        expect(contents).toContain('**Usage:**');
    });

    it('should provide full hover info when it is strictly the LAST line of file', async () => {
        const text = `2023-01-01 End Of File
    Assets:Bank    -10
    Expenses:LastOne`; // No newline at end
        const document = TextDocument.create('file:///eof.journal', 'hledger', 1, text);
        const parsed = parser.parse(document, { baseUri: 'file:///eof.journal', fileReader: defaultFileReader });

        expect(parsed.accounts.has('Expenses:LastOne')).toBe(true);

        // Hover over "LastOne"
        const hover = hoverProvider.provideHover(document, 2, 15, parsed);
        const contents = (hover?.contents as any).value;

        expect(contents).toContain('**Usage:**');
    });
});
