import { InlayHintsProvider } from '../../src/features/inlayHints';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range, InlayHintLabelPart } from 'vscode-languageserver';
import { HledgerParser } from '../../src/parser';

function labelToString(label: string | InlayHintLabelPart[]): string {
  if (typeof label === 'string') return label;
  return label.map(part => part.value).join('');
}

describe('InlayHintsProvider Extra Coverage', () => {
  let provider: InlayHintsProvider;
  let parser: HledgerParser;

  beforeEach(() => {
    provider = new InlayHintsProvider();
    parser = new HledgerParser();
  });

  test('should NOT show inferred amount if there is unexpected content after account', () => {
    const content = `2024-01-15 * Grocery Store
    expenses:food  unexpected   
    assets:checking`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);
    const range = Range.create(0, 0, 2, 0);

    const hints = provider.provideInlayHints(doc, range, parsed, {
      inlayHints: { showInferredAmounts: true }
    } as any);

    expect(hints).toHaveLength(0); // Should be blocked
  });

  test('should show inferred amount BEFORE comment', () => {
    // Use a valid transaction where one amount is known
    const content = `2024-01-15 * Grocery Store
    expenses:food   ; This is a comment
    assets:checking  $-50`;

    const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
    const parsed = parser.parse(doc);
    const range = Range.create(0, 0, 2, 0);

    const hints = provider.provideInlayHints(doc, range, parsed, {
      inlayHints: { showInferredAmounts: true }
    } as any);

    expect(hints).toHaveLength(1);
    expect(labelToString(hints[0].label)).toContain('$50');

    // Check position: should be before comment.
    // Line 1: "    expenses:food   ; This is a comment"
    // Comment starts at index 20.
    const commentIndex = content.split('\n')[1].indexOf(';');

    // The hint should be inserted at the end of the content (before comment)
    expect(hints[0].position.character).toBe(commentIndex);
  });
});
