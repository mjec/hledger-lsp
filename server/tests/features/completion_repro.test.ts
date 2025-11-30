
import { CompletionProvider } from '../../src/features/completion';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItemKind } from 'vscode-languageserver';

describe('CompletionProvider Repro', () => {
    let provider: CompletionProvider;

    beforeEach(() => {
        provider = new CompletionProvider();
        provider.updateAccounts([
            { name: 'expenses:food', declared: true },
            { name: 'expenses:transport', declared: true }
        ]);
    });

    test('should provide textEdit to replace existing prefix', () => {
        const content = '    expenses:';
        const doc = TextDocument.create('file:///test.journal', 'hledger', 1, content);
        // Cursor is at the end of the line
        const position = { line: 0, character: 13 };

        const items = provider.getCompletionItems(doc, position);

        expect(items.length).toBeGreaterThan(0);
        const foodItem = items.find(i => i.label === 'expenses:food');
        expect(foodItem).toBeDefined();

        // This expectation is expected to fail currently because textEdit is missing
        expect(foodItem!.textEdit).toBeDefined();

        if (foodItem!.textEdit) {
            // It should replace "expenses:" with "expenses:food"
            // Range should be from character 4 to 13
            expect((foodItem!.textEdit as any).range).toEqual({
                start: { line: 0, character: 4 },
                end: { line: 0, character: 13 }
            });
            expect(foodItem!.textEdit.newText).toBe('expenses:food');
        }
    });
});
