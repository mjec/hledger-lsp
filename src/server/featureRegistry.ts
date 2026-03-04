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

    // Provide completion items
    connection.onCompletion(
        async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
            try {
                const document = getDocument(textDocumentPosition.textDocument.uri);
                if (!document) {
                    return [];
                }

                // Completion needs workspace-wide accounts/payees/commodities for accurate suggestions
                const parsed = parseDocument(document);

                // Get settings for completion filtering
                const settings = await getDocumentSettings(URI.parse(textDocumentPosition.textDocument.uri));

                return completionProvider.getCompletionItems(document, textDocumentPosition.position, parsed, settings?.completion);
            } catch (error) {
                connection.console.error(`Error in completion: ${error}`);
                return [];
            }
        }
    );

    // Resolve additional information for completion items
    connection.onCompletionResolve(
        (item: CompletionItem): CompletionItem => {
            // Completion items from CompletionProvider already have all necessary details
            // This handler is kept for future extensibility
            return item;
        }
    );

    // Provide hover information
    connection.onHover(async (params, _token) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return null;

        const parsed = parseDocument(document);
        const settings = await getDocumentSettings(URI.parse(params.textDocument.uri));

        const hover = hoverProvider.provideHover(document, params.position.line, params.position.character, parsed, settings);
        return hover;
    });

    // Provide definition locations (go-to-definition)
    connection.onDefinition((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return null;

        // Parse document with includes using server's fileReader
        const parsed = parseDocument(document);

        const loc = definitionProvider.provideDefinition(document, params.position.line, params.position.character, parsed);
        return loc ? [loc] : null;
    });

    // Provide references (find all usages)
    connection.onReferences((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return null;

        // Parse document with includes using server's fileReader
        const parsed = parseDocument(document);

        // Try to use workspace-wide search if workspace is available
        const workspaceManager = getWorkspaceManager();
        if (workspaceManager) {
            const workspaceFiles = workspaceManager.getAllWorkspaceFiles();
            if (workspaceFiles.length > 0) {
                return findReferencesProvider.findWorkspaceReferences(
                    document,
                    params.position,
                    parsed,
                    workspaceFiles,
                    sharedParser,
                    fileReader
                );
            }
        }

        // Fallback to single-file search
        return findReferencesProvider.findReferences(
            document,
            params.position,
            parsed,
        );
    });

    // Provide document symbols (outline view)
    connection.onDocumentSymbol((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return [];

        // Parse document with includes using server's fileReader
        const parsed = parseDocument(document);

        return documentSymbolProvider.provideDocumentSymbols(document, parsed);
    });

    // Provide workspace symbols (project-wide search)
    connection.onWorkspaceSymbol((params) => {
        // Get any open document to serve as the entry point
        // The parsed document will include all entities from all included files
        const allDocuments = context.documents.all();
        if (allDocuments.length === 0) return [];

        // Use the first document as the entry point for workspace-wide search
        const document = allDocuments[0];

        // Parse with includes to get all entities across the workspace
        const parsed = parseDocument(document);

        return workspaceSymbolProvider.provideWorkspaceSymbols(params.query, parsed);
    });

    // Provide code actions (quick fixes and refactorings)
    connection.onCodeAction((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return [];

        // Parse document with includes
        const parsed = parseDocument(document);

        // Get diagnostics from the context
        const diagnostics = params.context.diagnostics;

        return codeActionProvider.provideCodeActions(
            document,
            params.range,
            diagnostics,
            parsed
        );
    });

    // Provide document formatting
    connection.onDocumentFormatting(async (params) => {
        try {
            const document = getDocument(params.textDocument.uri);
            if (!document) return [];

            // Parse document
            const parsed = parseDocument(document);

            // Get formatting settings
            const settings = await getDocumentSettings(URI.parse(params.textDocument.uri));
            const formattingOptions = settings?.formatting || {};
            connection.console.log(`Formatting`);

            return formattingProvider.formatDocument(document, parsed, params.options, formattingOptions, settings?.inlayHints);
        } catch (error) {
            connection.console.error(`Error in document formatting: ${error}`);
            return [];
        }
    });

    // Provide range formatting
    connection.onDocumentRangeFormatting(async (params) => {
        try {
            const document = getDocument(params.textDocument.uri);
            if (!document) return [];

            // Parse document
            const parsed = parseDocument(document);

            // Get formatting settings
            const settings = await getDocumentSettings(URI.parse(params.textDocument.uri));
            const formattingOptions = settings?.formatting || {};

            return formattingProvider.formatRange(document, params.range, parsed, params.options, formattingOptions, settings?.inlayHints);
        } catch (error) {
            connection.console.error(`Error in range formatting: ${error}`);
            return [];
        }
    });

    // Provide on-type formatting
    connection.onDocumentOnTypeFormatting(async (params) => {
        try {
            const document = getDocument(params.textDocument.uri);
            if (!document) return [];

            // Parse document
            const parsed = parseDocument(document);

            // Get formatting settings
            const settings = await getDocumentSettings(URI.parse(params.textDocument.uri));
            const formattingOptions = settings?.formatting || {};

            return formattingProvider.formatOnType(
                document,
                params.position,
                params.ch,
                parsed,
                params.options,
                formattingOptions,
                settings?.inlayHints
            );
        } catch (error) {
            connection.console.error(`Error in on-type formatting: ${error}`);
            return [];
        }
    });

    // Provide semantic tokens
    connection.languages.semanticTokens.on((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return { data: [] };

        const data = semanticTokensProvider.provideSemanticTokens(document);
        return { data };
    });

    // Provide inlay hints
    connection.languages.inlayHint.on(async (params) => {
        try {
            const document = getDocument(params.textDocument.uri);
            if (!document) {
                connection.console.warn(`[InlayHint] Document not found: ${params.textDocument.uri}`);
                return [];
            }

            // Get settings for inlay hints
            const settings = await getDocumentSettings(URI.parse(params.textDocument.uri));

            const parsed = parseDocument(document);

            const hints = inlayHintsProvider.provideInlayHints(
                document,
                params.range,
                parsed,
                settings
            );

            return hints;
        } catch (error) {
            connection.console.error(`Error providing inlay hints: ${error}`);
            return [];
        }
    });

    // Provide code lenses
    connection.onCodeLens(async (params) => {
        try {
            const document = getDocument(params.textDocument.uri);
            if (!document) return [];

            // CodeLens always needs workspace state for accurate transaction counts and balances
            const parsed = parseDocument(document);

            // Get settings for code lens
            const settings = await getDocumentSettings(URI.parse(params.textDocument.uri));
            const codeLensSettings = settings?.codeLens || undefined;

            return codeLensProvider.provideCodeLenses(
                document,
                parsed,
                codeLensSettings
            );
        } catch (error) {
            connection.console.error(`Error providing code lenses: ${error}`);
            return [];
        }
    });

    // Prepare rename - validate that position is on a renameable item
    connection.onPrepareRename((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return null;

        const parsed = parseDocument(document);
        const item = findReferencesProvider.getItemAtCursor(document, params.position, parsed);

        if (!item) return null;

        // Return the range and placeholder text
        const line = document.getText().split('\n')[params.position.line];
        if (!line) return null;

        // Find the item name in the line to get its range
        const index = line.indexOf(item.name);
        if (index === -1) return null;

        return {
            range: {
                start: { line: params.position.line, character: index },
                end: { line: params.position.line, character: index + item.name.length }
            },
            placeholder: item.name
        };
    });

    // Rename request - perform the actual rename
    connection.onRenameRequest((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return null;

        const parsed = parseDocument(document);
        const item = findReferencesProvider.getItemAtCursor(document, params.position, parsed);

        if (!item) return null;

        // Try to use workspace-wide rename if workspace is available
        const workspaceManager = getWorkspaceManager();
        if (workspaceManager) {
            const workspaceFiles = workspaceManager.getAllWorkspaceFiles();
            if (workspaceFiles.length > 0) {
                return codeActionProvider.createWorkspaceRenameEdit(
                    item,
                    params.newName,
                    workspaceFiles,
                    sharedParser,
                    fileReader
                );
            }
        }

        // Fallback to single-file rename
        return codeActionProvider.createRenameEdit(document, item, params.newName, parsed);
    });

    // Provide folding ranges
    connection.onFoldingRanges((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return [];

        // Parse document
        const parsed = parseDocument(document);

        return foldingRangesProvider.provideFoldingRanges(document, parsed);
    });

    // Provide document links
    connection.onDocumentLinks((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return [];

        // Parse document
        const parsed = parseDocument(document);

        return documentLinksProvider.provideDocumentLinks(document, parsed);
    });

    // Provide selection ranges
    connection.onSelectionRanges((params) => {
        const document = getDocument(params.textDocument.uri);
        if (!document) return [];

        return selectionRangeProvider.provideSelectionRanges(document, params.positions) || [];
    });

    // Provide call hierarchy (prepare)
    connection.languages.callHierarchy.onPrepare((params) => {
        const workspaceManager = getWorkspaceManager();
        if (!workspaceManager) return null;

        const document = getDocument(params.textDocument.uri);
        if (!document) return null;

        const parsedDoc = parseDocument(document);
        return callHierarchyProvider.prepareCallHierarchy(
            document,
            params.position.line,
            params.position.character,
            parsedDoc,
            workspaceManager
        );
    });

    // Provide call hierarchy (incoming calls)
    connection.languages.callHierarchy.onIncomingCalls((params) => {
        const workspaceManager = getWorkspaceManager();
        if (!workspaceManager) return null;

        return callHierarchyProvider.resolveIncomingCalls(
            params.item,
            workspaceManager,
            fileReader
        );
    });

    // Provide call hierarchy (outgoing calls)
    connection.languages.callHierarchy.onOutgoingCalls((params) => {
        const workspaceManager = getWorkspaceManager();
        if (!workspaceManager) return null;

        return callHierarchyProvider.resolveOutgoingCalls(
            params.item,
            workspaceManager,
            fileReader
        );
    });

    // Handle command execution
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
            // Look for the end of the amount, or end of the account if no amount
            // Skip leading whitespace and account name
            let insertPos = lineText.length;

            // Find the end of non-comment, non-whitespace content
            const commentMatch = lineText.match(/\s*[;#]/);
            if (commentMatch && commentMatch.index !== undefined) {
                insertPos = commentMatch.index;
            } else {
                // Trim trailing whitespace
                insertPos = lineText.trimEnd().length;
            }

            // Build the assertion text
            const assertionText = `  = ${amounts.join(', ')}`;

            // Create and apply the edit
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

            // Trigger inlay hint refresh to clear the hint after insertion
            await connection.languages.inlayHint.refresh().catch((_err) => {
                // Ignore errors if client doesn't support refresh
            });
        } else if (params.command === 'hledger.insertInferredAmount') {
            const [uri, line, accountEnd, quantity, commodity] = params.arguments as [string, number, number, number, string];
            const document = getDocument(uri);

            if (!document) {
                return;
            }

            // Get parsed document and settings for proper formatting
            const parsed = parseDocument(document);
            const settings = await getDocumentSettings(URI.parse(uri));

            // Get the line text
            const lineText = document.getText({
                start: { line, character: 0 },
                end: { line, character: Number.MAX_SAFE_INTEGER }
            });

            // Calculate padding and insertion position using same logic as inlay hints
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

            // Create and apply the edit
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

            // Trigger inlay hint refresh to clear the hint after insertion
            await connection.languages.inlayHint.refresh().catch((_err) => {
                // Ignore errors if client doesn't support refresh
            });
        } else if (params.command === 'hledger.refreshInlayHints') {
            // Manually refresh inlay hints
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
                // connection.window.showErrorMessage('Workspace manager not initialized');
                return [];
            }
        } else if (params.command === 'hledger.insertCost') {
            // Future command implementation placeholder
            connection.console.log(`[ExecuteCommand] insertCost command not yet implemented`);
        }
    });
}
