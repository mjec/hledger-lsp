
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HoverProvider } from '../../src/features/hover';
import { ParsedDocument } from '../../src/types';

describe('HoverProvider Transaction Header Mismatch', () => {
  let hoverProvider: HoverProvider;

  beforeEach(() => {
    hoverProvider = new HoverProvider();
  });

  it('should show the correct transaction when multiple files have transactions on the same line', () => {
    const targetUri = URI.parse('file:///home/user/target.journal');
    const otherUri = URI.parse('file:///home/user/other.journal');
    const line = 5;

    // Create a document representing "target.journal" at line 5
    // 5 newlines -> line indices 0,1,2,3,4,5
    const document = TextDocument.create(targetUri.toString(), 'hledger', 1,
      '\n\n\n\n\n2023-01-01 Target Transaction');

    // Mock parsed document containing TWO transactions on line 5
    const parsed: ParsedDocument = {
      transactions: [
        {
          line: line,
          sourceUri: otherUri,
          description: 'Wrong Transaction (Other File)',
          date: '2023-01-01',
          payee: '',
          note: '',
          postings: []
        },
        {
          line: line,
          sourceUri: targetUri,
          description: 'Correct Transaction (Target File)',
          date: '2023-01-01',
          payee: '',
          note: '',
          postings: []
        }
      ],
      accounts: new Map(),
      commodities: new Map(),
      payees: new Map(),
      tags: new Map(),
      directives: []
    };

    // We want to fetch hover for the TARGET file
    // Hover over "Target" (starts at index 11) to avoid Date hover priority
    const hover = hoverProvider.provideHover(document, line, 15, parsed);
    const contents = (hover?.contents as any).value;

    // This should fail currently if it picks the first one (Other File)
    expect(contents).toContain('Correct Transaction');
    expect(contents).not.toContain('Wrong Transaction');
  });
});
