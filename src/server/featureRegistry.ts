import {
    Connection,
    TextDocumentPositionParams,
    CompletionItem,
    TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { completionProvider } from '../features/completion';
import { hoverProvider } from '../features/hover';
import { definitionProvider } from '../features/definition';
import { documentSymbolProvider, workspaceSymbolProvider } from '../features/symbols';
import { codeActionProvider } from '../features/codeActions';
import { formattingProvider } from '../features/formatter';
import { semanticTokensProvider } from '../features/semanticTokens';
import { inlayHintsProvider } from '../features/inlayHints';
import { codeLensProvider } from '../features/codeLens';
import { findReferencesProvider } from '../features/findReferences';
import { foldingRangesProvider } from '../features/foldingRanges';
import { documentLinksProvider } from '../features/documentLinks';
import { selectionRangeProvider } from '../features/selectionRange';
import { callHierarchyProvider } from '../features/callHierarchy';

import { ParsedDocument, FileReader } from '../types';
import { HledgerSettings, defaultSettings } from './settings';
import { WorkspaceManager } from './workspace';
import { HledgerParser } from '../parser/index';

export interface ServiceRegistryContext {
    connection: Connection;
    documents: TextDocuments<TextDocument>;
    getWorkspaceManager: () => WorkspaceManager | null;
    sharedParser: HledgerParser;
    fileReader: FileReader;
    hasConfigurationCapability: boolean;
    hasInlayHintRefreshSupport: boolean;
    getDocument: (uri: string) => TextDocument | undefined;
    parseDocument: (document: TextDocument) => ParsedDocument;
    getDocumentSettings: (uri: URI) => Thenable<HledgerSettings>;
}

export function registerLanguageFeatures(context: ServiceRegistryContext): void {
    const {
        connection,
        getWorkspaceManager,
        sharedParser,
        fileReader,
        hasInlayHintRefreshSupport,
        getDocument,
        parseDocument,
        getDocumentSettings
    } = context;

    /**
     * Get document and parse it, returning defaultValue if document not found.
     */
    function withDocument<T>(
        uri: string,
        defaultValue: T,
        handler: (document: TextDocument, parsed: ParsedDocument) => T
    ): T {
        const document = getDocument(uri);
        if (!document) return defaultValue;
        const parsed = parseDocument(document);
        return handler(document, parsed);
    }

    /**
     * Get document, parse it, and fetch settings. Wraps in try/catch.
     */
    async function withDocumentAndSettings<T>(
        uri: string,
        defaultValue: T,
        handler: (document: TextDocument, parsed: ParsedDocument, settings: HledgerSettings) => T
    ): Promise<T> {
        try {
            const document = getDocument(uri);
            if (!document) return defaultValue;
            const parsed = parseDocument(document);
            const settings = await getDocumentSettings(URI.parse(uri));
            return handler(document, parsed, settings);
        } catch (error) {
            connection.console.error(`Error: ${error}`);
            return defaultValue;
        }
    }

    // ── Completion ──────────────────────────────────────────────────────

    connection.onCompletion(
        (params: TextDocumentPositionParams): Promise<CompletionItem[]> =>
            withDocumentAndSettings(params.textDocument.uri, [], (document, parsed, settings) =>
                completionProvider.getCompletionItems(document, params.position, parsed, settings?.completion)
            )
    );

    connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

    // ── Hover & Info ────────────────────────────────────────────────────

    connection.onHover((params) =>
        withDocumentAndSettings(params.textDocument.uri, null, (document, parsed, settings) =>
            hoverProvider.provideHover(document, params.position.line, params.position.character, parsed, settings)
        )
    );

    // ── Navigation ──────────────────────────────────────────────────────

    connection.onDefinition((params) =>
        withDocument(params.textDocument.uri, null, (document, parsed) => {
            const loc = definitionProvider.provideDefinition(document, params.position.line, params.position.character, parsed);
            return loc ? [loc] : null;
        })
    );

    connection.onReferences((params) =>
        withDocument(params.textDocument.uri, null, (document, parsed) => {
            const workspaceManager = getWorkspaceManager();
            if (workspaceManager) {
                const workspaceFiles = workspaceManager.getAllWorkspaceFiles();
                if (workspaceFiles.length > 0) {
                    return findReferencesProvider.findWorkspaceReferences(
                        document, params.position, parsed,
                        workspaceFiles, sharedParser, fileReader
                    );
                }
            }
            return findReferencesProvider.findReferences(document, params.position, parsed);
        })
    );

    connection.onDocumentLinks((params) =>
        withDocument(params.textDocument.uri, [], (document, parsed) =>
            documentLinksProvider.provideDocumentLinks(document, parsed)
        )
    );

    connection.onSelectionRanges((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return [];
        return selectionRangeProvider.provideSelectionRanges(document, params.positions) || [];
    });

    // ── Symbols ─────────────────────────────────────────────────────────

    connection.onDocumentSymbol((params) =>
        withDocument(params.textDocument.uri, [], (document, parsed) =>
            documentSymbolProvider.provideDocumentSymbols(document, parsed)
        )
    );

    connection.onWorkspaceSymbol((params) => {
        const allDocuments = context.documents.all();
        if (allDocuments.length === 0) return [];
        const parsed = parseDocument(allDocuments[0]);
        return workspaceSymbolProvider.provideWorkspaceSymbols(params.query, parsed);
    });

    // ── Code Actions & Rename ───────────────────────────────────────────

    connection.onCodeAction((params) =>
        withDocument(params.textDocument.uri, [], (document, parsed) =>
            codeActionProvider.provideCodeActions(document, params.range, params.context.diagnostics, parsed)
        )
    );

    connection.onPrepareRename((params) =>
        withDocument(params.textDocument.uri, null, (document, parsed) => {
            const item = findReferencesProvider.getItemAtCursor(document, params.position, parsed);
            if (!item) return null;

            const line = document.getText().split('\n')[params.position.line];
            if (!line) return null;

            const index = line.indexOf(item.name);
            if (index === -1) return null;

            return {
                range: {
                    start: { line: params.position.line, character: index },
                    end: { line: params.position.line, character: index + item.name.length }
                },
                placeholder: item.name
            };
        })
    );

    connection.onRenameRequest((params) =>
        withDocument(params.textDocument.uri, null, (document, parsed) => {
            const item = findReferencesProvider.getItemAtCursor(document, params.position, parsed);
            if (!item) return null;

            const workspaceManager = getWorkspaceManager();
            if (workspaceManager) {
                const workspaceFiles = workspaceManager.getAllWorkspaceFiles();
                if (workspaceFiles.length > 0) {
                    return codeActionProvider.createWorkspaceRenameEdit(
                        item, params.newName, workspaceFiles, sharedParser, fileReader
                    );
                }
            }
            return codeActionProvider.createRenameEdit(document, item, params.newName, parsed);
        })
    );

    // ── Formatting ──────────────────────────────────────────────────────

    connection.onDocumentFormatting((params) =>
        withDocumentAndSettings(params.textDocument.uri, [], (document, parsed, settings) => {
            connection.console.log(`Formatting`);
            return formattingProvider.formatDocument(document, parsed, params.options, settings?.formatting || {}, settings?.inlayHints);
        })
    );

    connection.onDocumentRangeFormatting((params) =>
        withDocumentAndSettings(params.textDocument.uri, [], (document, parsed, settings) =>
            formattingProvider.formatRange(document, params.range, parsed, params.options, settings?.formatting || {}, settings?.inlayHints)
        )
    );

    connection.onDocumentOnTypeFormatting((params) =>
        withDocumentAndSettings(params.textDocument.uri, [], (document, parsed, settings) =>
            formattingProvider.formatOnType(document, params.position, params.ch, parsed, params.options, settings?.formatting || {}, settings?.inlayHints)
        )
    );

    // ── Semantic Tokens ─────────────────────────────────────────────────

    connection.languages.semanticTokens.on((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return { data: [] };
        return { data: semanticTokensProvider.provideSemanticTokens(document) };
    });

    // ── Inlay Hints ─────────────────────────────────────────────────────

    connection.languages.inlayHint.on((params) =>
        withDocumentAndSettings(params.textDocument.uri, [], (document, parsed, settings) =>
            inlayHintsProvider.provideInlayHints(document, params.range, parsed, settings)
        )
    );

    // ── Code Lens ───────────────────────────────────────────────────────

    connection.onCodeLens((params) =>
        withDocumentAndSettings(params.textDocument.uri, [], (document, parsed, settings) =>
            codeLensProvider.provideCodeLenses(document, parsed, settings?.codeLens)
        )
    );

    // ── Folding Ranges ──────────────────────────────────────────────────

    connection.onFoldingRanges((params) =>
        withDocument(params.textDocument.uri, [], (document, parsed) =>
            foldingRangesProvider.provideFoldingRanges(document, parsed)
        )
    );

    // ── Call Hierarchy ──────────────────────────────────────────────────

    connection.languages.callHierarchy.onPrepare((params) => {
        const workspaceManager = getWorkspaceManager();
        if (!workspaceManager) return null;
        return withDocument(params.textDocument.uri, null, (document, parsed) =>
            callHierarchyProvider.prepareCallHierarchy(
                document, params.position.line, params.position.character, parsed, workspaceManager
            )
        );
    });

    connection.languages.callHierarchy.onIncomingCalls((params) => {
        const workspaceManager = getWorkspaceManager();
        if (!workspaceManager) return null;
        return callHierarchyProvider.resolveIncomingCalls(params.item, workspaceManager, fileReader);
    });

    connection.languages.callHierarchy.onOutgoingCalls((params) => {
        const workspaceManager = getWorkspaceManager();
        if (!workspaceManager) return null;
        return callHierarchyProvider.resolveOutgoingCalls(params.item, workspaceManager, fileReader);
    });

    // ── Commands ────────────────────────────────────────────────────────

    connection.onExecuteCommand(async (params) => {
        connection.console.log(`[ExecuteCommand] ${params.command}`);

        if (params.command === 'hledger.addBalanceAssertion' || params.command === 'hledger.insertBalanceAssertion') {
            const [uri, line, amounts] = params.arguments as [string, number, string[]];
            const document = getDocument(uri);

            if (!document) {
                return;
            }

            // Get the line text
            const lineText = document.getText({
                start: { line, character: 0 },
                end: { line, character: Number.MAX_SAFE_INTEGER }
            });

            // Find where to insert the assertion
            let insertPos = lineText.length;
            const commentMatch = lineText.match(/\s*[;#]/);
            if (commentMatch && commentMatch.index !== undefined) {
                insertPos = commentMatch.index;
            } else {
                insertPos = lineText.trimEnd().length;
            }

            const assertionText = `  = ${amounts.join(', ')}`;

            await connection.workspace.applyEdit({
                changes: {
                    [uri]: [{
                        range: {
                            start: { line, character: insertPos },
                            end: { line, character: insertPos }
                        },
                        newText: assertionText
                    }]
                }
            });

            await connection.languages.inlayHint.refresh().catch(() => {});
        } else if (params.command === 'hledger.insertInferredAmount') {
            const [uri, line, accountEnd, quantity, commodity] = params.arguments as [string, number, number, number, string];
            const document = getDocument(uri);

            if (!document) {
                return;
            }

            const parsed = parseDocument(document);
            const settings = await getDocumentSettings(URI.parse(uri));

            const lineText = document.getText({
                start: { line, character: 0 },
                end: { line, character: Number.MAX_SAFE_INTEGER }
            });

            const { getAmountLayout, formatAmount } = await import('../utils/amountFormatter');

            const options = {
                ...settings?.formatting
            };

            const amount = { quantity, commodity };
            const layout = getAmountLayout(amount, parsed, options as any, '');
            const preDecimalWidth =
                layout.commodityBefore.length +
                (layout.spaceBetweenCommodityAndAmount && layout.commodityBefore ? 1 : 0) +
                (layout.negPosSign ? 1 : 0) +
                layout.amountIntegerString.length;

            const commentMatch = lineText.match(/\s*[;#]/);
            const endOfContent = commentMatch && commentMatch.index !== undefined
                ? commentMatch.index
                : lineText.trimEnd().length;

            const afterAccount = lineText.substring(accountEnd, endOfContent);
            const existingWhitespace = afterAccount.length;

            const targetColumn = options.decimalAlignColumn || 50;
            const minSpacing = options.minSpacing || 2;
            const requiredSpacing = Math.max(
                minSpacing,
                targetColumn - accountEnd - preDecimalWidth
            );

            let insertPos: number;
            let padding: string;

            if (existingWhitespace >= requiredSpacing) {
                insertPos = accountEnd + requiredSpacing;
                padding = '';
            } else {
                insertPos = endOfContent;
                padding = ' '.repeat(Math.max(minSpacing, requiredSpacing - existingWhitespace));
            }

            const amountText = formatAmount(quantity, commodity, parsed, settings?.formatting);
            const insertText = `${padding}${amountText}`;

            await connection.workspace.applyEdit({
                changes: {
                    [uri]: [{
                        range: {
                            start: { line, character: insertPos },
                            end: { line, character: insertPos }
                        },
                        newText: insertText
                    }]
                }
            });

            await connection.languages.inlayHint.refresh().catch(() => {});
        } else if (params.command === 'hledger.refreshInlayHints') {
            if (hasInlayHintRefreshSupport) {
                await connection.languages.inlayHint.refresh().catch((err) => {
                    connection.console.error(`Failed to refresh inlay hints: ${err}`);
                });
            } else {
                connection.window.showInformationMessage('Inlay hint refresh not supported by your editor');
            }
        } else if (params.command === 'hledger.showWorkspaceGraphStructured') {
            const workspaceManager = getWorkspaceManager();
            connection.console.log(`[ExecuteCommand] showWorkspaceGraphStructured called. workspaceManager exists: ${!!workspaceManager}`);
            if (workspaceManager) {
                try {
                    const entries = workspaceManager.getWorkspaceTreeStructured();
                    connection.console.log(`[ExecuteCommand] Structured tree generated, ${entries.length} entries`);
                    return entries;
                } catch (error) {
                    connection.console.error(`[ExecuteCommand] Error generating structured tree: ${error}`);
                    return [];
                }
            } else {
                connection.console.warn('[ExecuteCommand] Workspace manager not initialized');
                return [];
            }
        } else if (params.command === 'hledger.insertCost') {
            connection.console.log(`[ExecuteCommand] insertCost command not yet implemented`);
        }
    });
}
