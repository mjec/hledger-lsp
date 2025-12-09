#!/usr/bin/env node

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  DidChangeConfigurationNotification,
  ServerCapabilities,
  SemanticTokensLegend
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { completionProvider } from './features/completion';
import { hoverProvider } from './features/hover';
import { definitionProvider } from './features/definition';
import { documentSymbolProvider, workspaceSymbolProvider } from './features/symbols';
import { codeActionProvider } from './features/codeActions';
import { formattingProvider } from './features/formatter';
import { semanticTokensProvider, tokenTypes, tokenModifiers } from './features/semanticTokens';
import { inlayHintsProvider } from './features/inlayHints';
import { codeLensProvider } from './features/codeLens';
import { findReferencesProvider } from './features/findReferences';
import { validator } from './features/validator';
import { foldingRangesProvider } from './features/foldingRanges';
import { documentLinksProvider } from './features/documentLinks';
import { selectionRangeProvider } from './features/selectionRange';
import { HledgerParser, FileReader } from './parser/index';
import { HledgerSettings, defaultSettings, getDocumentSettings as getDocumentSettingsModule, clearDocumentSettings, clearAllDocumentSettings } from './server/settings';
import { defaultFileReader, resolveIncludePath as resolveIncludePathUtil, toFilePath, toFileUri } from './utils/uri';
import { WorkspaceManager } from './server/workspace';
import * as path from 'path';

// Check for version flag
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const packageJson = require('../package.json');
    console.log(`hledger-lsp v${packageJson.version}`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to read version information');
    process.exit(1);
  }
}

// Create a connection for the server using Node's IPC as a transport
const connection = createConnection(ProposedFeatures.all);

connection.console.log('========== HLEDGER LSP SERVER STARTING ==========');

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasDidChangeConfigurationDynamicRegistration = false;
let hasInlayHintRefreshSupport = false;
let hasCodeLensRefreshSupport = false;

// Workspace state
let workspaceFolders: string[] = [];
let workspaceManager: WorkspaceManager | null = null;

connection.onInitialize((params: InitializeParams) => {
  connection.console.log('========== ON INITIALIZE CALLED ==========');
  connection.console.log(`rootUri: ${params.rootUri}`);
  connection.console.log(`rootPath: ${params.rootPath}`);
  connection.console.log(`workspaceFolders: ${JSON.stringify(params.workspaceFolders)}`);

  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  // Check if client supports dynamic registration for didChangeConfiguration
  hasDidChangeConfigurationDynamicRegistration = !!(
    capabilities.workspace &&
    capabilities.workspace.didChangeConfiguration &&
    capabilities.workspace.didChangeConfiguration.dynamicRegistration
  );

  // Check if client supports inlay hint refresh
  hasInlayHintRefreshSupport = !!(
    capabilities.workspace &&
    capabilities.workspace.inlayHint &&
    capabilities.workspace.inlayHint.refreshSupport
  );

  hasCodeLensRefreshSupport = !!(
    capabilities.workspace &&
    capabilities.workspace.codeLens &&
    capabilities.workspace.codeLens.refreshSupport
  );

  connection.console.log(`Inlay hint refresh support: ${hasInlayHintRefreshSupport}`);
  connection.console.log(`Code lens refresh support: ${hasCodeLensRefreshSupport}`);

  // Store workspace folders
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    workspaceFolders = params.workspaceFolders.map(folder => folder.uri);
  } else if (params.rootUri) {
    workspaceFolders = [params.rootUri];
  }

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [':', ' ']
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      codeActionProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      documentOnTypeFormattingProvider: {
        firstTriggerCharacter: '\n',
      },
      semanticTokensProvider: {
        legend: {
          tokenTypes: tokenTypes,
          tokenModifiers: tokenModifiers
        },
        full: true
      },
      inlayHintProvider: true,
      codeLensProvider: {
        resolveProvider: false
      },
      renameProvider: {
        prepareProvider: true
      },
      foldingRangeProvider: true,
      documentLinkProvider: {
        resolveProvider: false
      },
      selectionRangeProvider: true,
      executeCommandProvider: {
        commands: [
          'hledger.addBalanceAssertion',
          'hledger.insertBalanceAssertion',
          'hledger.insertInferredAmount',
          'hledger.convertToTotalCost',
          'hledger.refreshInlayHints',
          'hledger.showWorkspaceGraph',
          'hledger.showWorkspaceGraphStructured'
        ]
      }
    }
  };

  // Log the semantic token legend being registered so clients/inspectors can verify
  // which token types/modifiers the server reports at runtime.
  try {
    connection.console.info(`Semantic tokens legend: ${JSON.stringify({ tokenTypes, tokenModifiers })}`);
  } catch (e) {
    connection.console.warn('Failed to log semantic tokens legend');
  }

  // Note: Workspace folders support removed to avoid warnings with clients
  // that don't support dynamic registration (like Neovim)

  connection.console.log('========== ON INITIALIZE COMPLETE ==========');
  connection.console.log(`workspaceFolders array: ${JSON.stringify(workspaceFolders)}`);

  return result;
});

connection.onInitialized(async () => {
  connection.console.log('========== ON INITIALIZED CALLED ==========');

  // Only use dynamic registration if the client supports it
  if (hasConfigurationCapability && hasDidChangeConfigurationDynamicRegistration) {
    // Register for all configuration changes dynamically
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }

  // Initialize WorkspaceManager if we have workspace folders
  if (workspaceFolders.length > 0) {
    await initializeWorkspaceManager(workspaceFolders);

    // Watch for config file changes
    // Note: Many clients (including Neovim LSP) don't support dynamic file watchers,
    // so we rely on onDidChangeWatchedFiles being called for any file changes
    // If the client supports it, the workspace/configuration already watches files
  } else {
    connection.console.log('hledger Language Server initialized (no workspace folders provided)');
    connection.console.log('WorkspaceManager will be initialized when first document is opened');
  }
});

// Helper function to initialize workspace manager
async function initializeWorkspaceManager(folders: string[], forceReinit: boolean = false): Promise<void> {
  if (workspaceManager && !forceReinit) {
    connection.console.log('WorkspaceManager already initialized');
    return;
  }

  // Get workspace settings to pass as runtime config
  const settings = await getDocumentSettings(folders[0]);
  const runtimeConfig = settings?.workspace ? {
    workspace: settings.workspace
  } : undefined;

  workspaceManager = new WorkspaceManager();
  try {
    connection.console.log(`Initializing WorkspaceManager with folders: ${folders.join(', ')}`);
    await workspaceManager.initialize(
      folders,
      sharedParser,
      fileReader,
      connection,
      runtimeConfig
    );

    // Log the root file being used
    const diagnostics = workspaceManager.getDiagnosticInfo();
    if (diagnostics.rootFile) {
      connection.console.info(`✓ Workspace root file: ${diagnostics.rootFile}`);
    } else {
      connection.console.warn(`⚠ No workspace root file detected - workspace features disabled`);
    }

    connection.console.log('hledger Language Server initialized with workspace awareness');

    // Refresh all open documents now that workspace context is available
    // This ensures features like inlay hints and diagnostics reflect the full workspace tree
    connection.console.log('Refreshing open documents with workspace context...');
    const openDocuments = documents.all();
    for (const doc of openDocuments) {
      // Re-validate with full workspace context
      await validateTextDocument(doc);
    }

    // Refresh inlay hints for all open documents
    if (hasInlayHintRefreshSupport) {
      connection.languages.inlayHint.refresh();
    }

    connection.console.log(`Refreshed ${openDocuments.length} open document(s) with workspace context`);
  } catch (error) {
    connection.console.error(`Failed to initialize WorkspaceManager: ${error}`);
    workspaceManager = null;
  }
}

// Global settings used when client does not support workspace/configuration
let globalSettings: HledgerSettings = defaultSettings;

// include dependency functions are centralized in src/server/deps.ts
import { updateDependencies, clearDependencies, getDependents } from './server/deps';

// Create a shared parser instance with caching
const sharedParser = new HledgerParser();

// Small helper to centralize parsing options and reduce duplication across handlers
function parseDocument(
  document: TextDocument,
  options?: { parseMode?: 'document' | 'workspace' }
) {
  const mode = options?.parseMode || 'document';

  // Workspace mode: parse from root file for global state
  if (mode === 'workspace' && workspaceManager) {
    const root = workspaceManager.getRootForFile(document.uri);
    if (root) {
      connection.console.info(`[parseDocument] Workspace mode: using root ${root}`);
      const parsed = workspaceManager.parseWorkspace();
      if (parsed) {
        return parsed;
      }
    }
    // Fallback to document mode if no root found (normal during initialization)
    connection.console.info(
      `[parseDocument] No root found yet for ${document.uri}, using document mode`
    );
  }

  // Document mode: standard include-based parsing
  connection.console.info(`[parseDocument] Document mode for ${document.uri}`);
  return sharedParser.parse(document, {
    baseUri: document.uri,
    fileReader
  });
}

connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    clearAllDocumentSettings();
    connection.console.log('hledger Language Server: configuration changed (workspace/configuration), clearing settings cache');
  } else {
    globalSettings = <HledgerSettings>(
      (change.settings.hledgerLanguageServer || defaultSettings)
    );
    connection.console.log('hledger Language Server: configuration changed (legacy settings), updating global settings');
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

// Wrapper around settings module to use connection and capability flag
function getDocumentSettings(resource: string): Thenable<HledgerSettings> {
  return getDocumentSettingsModule(connection, resource, hasConfigurationCapability);
}


// Lazy initialize workspace manager when first document is opened
documents.onDidOpen(async e => {
  connection.console.log('========== DOCUMENT OPENED ==========');
  connection.console.log(`Document URI: ${e.document.uri}`);
  connection.console.log(`workspaceManager exists: ${!!workspaceManager}`);
  connection.console.log(`workspaceFolders.length: ${workspaceFolders.length}`);

  // If workspace manager not initialized and we don't have workspace folders,
  // use the directory of the opened document as the workspace
  if (!workspaceManager && workspaceFolders.length === 0) {
    const uri = e.document.uri;
    const filePath = toFilePath(uri);
    const dirPath = path.dirname(filePath);
    const workspaceUri = toFileUri(dirPath);

    connection.console.log(`Lazy-initializing WorkspaceManager with directory: ${workspaceUri}`);
    await initializeWorkspaceManager([workspaceUri]);
  }
});

// Only keep settings for open documents
documents.onDidClose(e => {
  clearDocumentSettings(e.document.uri);
  clearDependencies(e.document.uri);
});

// The content of a text document has changed
documents.onDidChangeContent(change => {
  // Clear parser cache since a file changed
  // This ensures we re-parse files with fresh data
  sharedParser.clearCache();

  // Invalidate workspace cache for affected roots
  if (workspaceManager) {
    workspaceManager.invalidateFile(change.document.uri);
  }

  validateTextDocument(change.document);

  // Re-validate all files that depend on this one
  const dependents = getDependents(change.document.uri);
  if (dependents) {
    for (const dependentUri of dependents) {
      const dependentDoc = documents.get(dependentUri);
      if (dependentDoc) {
        validateTextDocument(dependentDoc);
      }
    }
  }

  // In workspace mode, changes to one file affect all files in the workspace
  // (e.g., running balances, transaction counts, completions)
  // Refresh workspace-wide features for all open documents
  if (workspaceManager) {
    const changedRoot = workspaceManager.getRootForFile(change.document.uri);

    if (changedRoot) {
      // Find all open documents that share the same root
      const allDocs = documents.all();

      const affectedDocs = allDocs.filter(doc => {
        const docRoot = workspaceManager!.getRootForFile(doc.uri);
        const isSameRoot = docRoot === changedRoot;
        const isDifferentFile = doc.uri !== change.document.uri;
        return isSameRoot && isDifferentFile;
      });

      // Re-validate affected documents (updates diagnostics)
      for (const doc of affectedDocs) {
        validateTextDocument(doc);
      }

      // Refresh inlay hints for all affected documents
      // This updates running balances, inferred amounts, etc.
      if (hasInlayHintRefreshSupport && affectedDocs.length > 0) {
        connection.console.log(`[Cascade Refresh] Refreshing inlay hints for ${affectedDocs.length} affected document(s)`);
        connection.languages.inlayHint.refresh();
      } else if (affectedDocs.length > 0) {
        connection.console.warn(`[Cascade Refresh] Cannot refresh inlay hints - client does not support refresh (${affectedDocs.length} affected docs)`);
      }

      // Note: Code lenses will refresh when the client next requests them
      // We've already invalidated the workspace cache above, which is sufficient
    }
  }
});

// Watch for config file changes (.hledger-lsp.json)
connection.onDidChangeWatchedFiles(async (params) => {
  for (const change of params.changes) {
    if (change.uri.endsWith('.hledger-lsp.json')) {
      connection.console.log(`Config file changed: ${change.uri}, reinitializing workspace`);

      // Reinitialize workspace manager with new config
      if (workspaceFolders.length > 0) {
        await initializeWorkspaceManager(workspaceFolders, true);

        // Revalidate all open documents with new configuration
        documents.all().forEach(validateTextDocument);
      }

      break; // Only reinitialize once even if multiple config files changed
    }
  }
});

// dependency tracking moved to src/server/deps.ts

// Create a file reader that uses in-memory documents when available
// This ensures we see unsaved changes in the editor
const fileReader: FileReader = (uri: string) => {
  // First, check if we have this document open in memory
  const openDoc = documents.get(uri);
  if (openDoc) {
    return openDoc;
  }

  // Fall back to reading from disk
  return defaultFileReader(uri);
};

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // Get document settings
  const settings = (await getDocumentSettings(textDocument.uri)) ?? defaultSettings;

  // Validation needs workspace state for balance assertions and full transaction history
  const parsedDoc = parseDocument(textDocument, { parseMode: 'workspace' });

  // Track which files this document includes
  const includedFiles = new Set<string>();
  for (const directive of parsedDoc.directives) {
    if (directive.type === 'include') {
      const resolvedPath = resolveIncludePathUtil(directive.value, textDocument.uri);
      includedFiles.add(resolvedPath);
    }
  }
  updateDependencies(textDocument.uri, includedFiles);

  // Update completion data from the parsed document (includes all workspace files)
  completionProvider.updateAccounts(parsedDoc.accounts);
  completionProvider.updatePayees(parsedDoc.payees);
  completionProvider.updateCommodities(parsedDoc.commodities);
  completionProvider.updateTags(parsedDoc.tags);

  // Validate the document with settings
  const validationResult = validator.validate(textDocument, parsedDoc, {
    baseUri: textDocument.uri,
    fileReader,
    settings: {
      validation: settings?.validation,
      severity: settings?.severity
    }
  });

  // Send diagnostics to the client
  connection.sendDiagnostics({
    uri: textDocument.uri,
    diagnostics: validationResult.diagnostics
  });
}

// include path resolution moved to src/utils/uri.ts

// Provide completion items
connection.onCompletion(
  async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
    try {
      const document = documents.get(textDocumentPosition.textDocument.uri);
      if (!document) {
        return [];
      }

      // Completion needs workspace-wide accounts/payees/commodities for accurate suggestions
      const parsed = parseDocument(document, { parseMode: 'workspace' });

      // Get settings for completion filtering
      const settings = await getDocumentSettingsModule(connection, textDocumentPosition.textDocument.uri, hasConfigurationCapability);

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
connection.onHover(async (params, token) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const parsed = parseDocument(document, { parseMode: 'workspace' });
  const settings = await getDocumentSettings(params.textDocument.uri);

  const hover = hoverProvider.provideHover(document, params.position.line, params.position.character, parsed, settings);
  return hover;
});

// Provide definition locations (go-to-definition)
connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  // Parse document with includes using server's fileReader
  const parsed = parseDocument(document, { parseMode: 'workspace' });

  const loc = definitionProvider.provideDefinition(document, params.position.line, params.position.character, parsed);
  return loc ? [loc] : null;
});

// Provide references (find all usages)
connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  // Parse document with includes using server's fileReader
  const parsed = parseDocument(document, { parseMode: 'workspace' });

  return findReferencesProvider.findReferences(
    document,
    params.position,
    parsed,
    params.context.includeDeclaration
  );
});

// Provide document symbols (outline view)
connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  // Parse document with includes using server's fileReader
  const parsed = parseDocument(document);

  return documentSymbolProvider.provideDocumentSymbols(document, parsed);
});

// Provide workspace symbols (project-wide search)
connection.onWorkspaceSymbol((params) => {
  // Get any open document to serve as the entry point
  // The parsed document will include all entities from all included files
  const allDocuments = documents.all();
  if (allDocuments.length === 0) return [];

  // Use the first document as the entry point for workspace-wide search
  const document = allDocuments[0];

  // Parse with includes to get all entities across the workspace
  const parsed = parseDocument(document);

  return workspaceSymbolProvider.provideWorkspaceSymbols(params.query, parsed);
});

// Provide code actions (quick fixes and refactorings)
connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
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
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    // Parse document
    const parsed = parseDocument(document);

    // Get formatting settings
    const settings = await getDocumentSettings(params.textDocument.uri);
    const formattingOptions = settings?.formatting || {};

    return formattingProvider.formatDocument(document, parsed, params.options, formattingOptions);
  } catch (error) {
    connection.console.error(`Error in document formatting: ${error}`);
    return [];
  }
});

// Provide range formatting
connection.onDocumentRangeFormatting(async (params) => {
  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    // Parse document
    const parsed = parseDocument(document);

    // Get formatting settings
    const settings = await getDocumentSettings(params.textDocument.uri);
    const formattingOptions = settings?.formatting || {};

    return formattingProvider.formatRange(document, params.range, parsed, params.options, formattingOptions);
  } catch (error) {
    connection.console.error(`Error in range formatting: ${error}`);
    return [];
  }
});

// Provide on-type formatting
connection.onDocumentOnTypeFormatting(async (params) => {
  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    // Parse document
    const parsed = parseDocument(document);

    // Get formatting settings
    const settings = await getDocumentSettings(params.textDocument.uri);
    const formattingOptions = settings?.formatting || {};

    return formattingProvider.formatOnType(
      document,
      params.position,
      params.ch,
      parsed,
      params.options,
      formattingOptions
    );
  } catch (error) {
    connection.console.error(`Error in on-type formatting: ${error}`);
    return [];
  }
});

// Provide semantic tokens
connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };

  // Parse document
  const parsed = parseDocument(document);

  const data = semanticTokensProvider.provideSemanticTokens(document, parsed);
  return { data };
});

// Provide inlay hints
connection.languages.inlayHint.on(async (params) => {
  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    // Get settings for inlay hints
    const settings = await getDocumentSettings(params.textDocument.uri);
    const inlayHintsSettings = settings?.inlayHints || undefined;

    // Use workspace mode for running balances (needs all transactions chronologically)
    // Use document mode for inferred amounts (single-file context sufficient)
    const parseMode = inlayHintsSettings?.showRunningBalances ? 'workspace' : 'document';
    const parsed = parseDocument(document, { parseMode });

    return inlayHintsProvider.provideInlayHints(
      document,
      params.range,
      parsed,
      settings
    );
  } catch (error) {
    connection.console.error(`Error providing inlay hints: ${error}`);
    return [];
  }
});

// Provide code lenses
connection.onCodeLens(async (params) => {
  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    // CodeLens always needs workspace state for accurate transaction counts and balances
    const parsed = parseDocument(document, { parseMode: 'workspace' });

    // Get settings for code lens
    const settings = await getDocumentSettings(params.textDocument.uri);
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
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const parsed = parseDocument(document);
  const item = codeActionProvider.getItemAtCursor(document, params.position, parsed);

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
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const parsed = parseDocument(document);
  const item = codeActionProvider.getItemAtCursor(document, params.position, parsed);

  if (!item) return null;

  // Create the workspace edit
  return codeActionProvider.createRenameEdit(document, item, params.newName, parsed);
});

// Provide folding ranges
connection.onFoldingRanges((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  // Parse document
  const parsed = parseDocument(document);

  return foldingRangesProvider.provideFoldingRanges(document, parsed);
});

// Provide document links
connection.onDocumentLinks((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  // Parse document
  const parsed = parseDocument(document);

  return documentLinksProvider.provideDocumentLinks(document, parsed);
});

// Provide selection ranges
connection.onSelectionRanges((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  // Parse document
  const parsed = parseDocument(document);

  return selectionRangeProvider.provideSelectionRanges(document, params.positions, parsed) || [];
});

// Handle command execution
connection.onExecuteCommand(async (params) => {
  connection.console.log(`[ExecuteCommand] ${params.command}`);

  if (params.command === 'hledger.addBalanceAssertion' || params.command === 'hledger.insertBalanceAssertion') {
    const [uri, line, account, amounts] = params.arguments as [string, number, string, string[]];
    const document = documents.get(uri);

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
    await connection.languages.inlayHint.refresh().catch((err) => {
      // Ignore errors if client doesn't support refresh
    });
  } else if (params.command === 'hledger.insertInferredAmount') {
    const [uri, line, account, amountText] = params.arguments as [string, number, string, string];
    const document = documents.get(uri);

    if (!document) {
      return;
    }

    // Get the line text
    const lineText = document.getText({
      start: { line, character: 0 },
      end: { line, character: Number.MAX_SAFE_INTEGER }
    });

    // Find where to insert the amount - after the account name
    // Skip leading whitespace and find account name
    const accountPos = lineText.indexOf(account);
    if (accountPos === -1) {
      return;
    }

    const insertPos = accountPos + account.length;

    // Build the amount text with proper spacing
    const insertText = `  ${amountText}`;

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
    await connection.languages.inlayHint.refresh().catch((err) => {
      // Ignore errors if client doesn't support refresh
    });
  } else if (params.command === 'hledger.convertToTotalCost') {
    const [uri, line, account, totalCostText] = params.arguments as [string, number, string, string];
    const document = documents.get(uri);

    if (!document) {
      return;
    }

    // Get the line text
    const lineText = document.getText({
      start: { line, character: 0 },
      end: { line, character: Number.MAX_SAFE_INTEGER }
    });

    // Find the unit cost notation (@ but not @@)
    // Match @ followed by non-@ character
    const unitCostMatch = lineText.match(/@(?!@)\s*[^;#\s]+/);
    if (!unitCostMatch || unitCostMatch.index === undefined) {
      return;
    }

    const startPos = unitCostMatch.index;
    const endPos = startPos + unitCostMatch[0].length;

    // Replace with total cost notation
    const newText = `@@ ${totalCostText}`;

    // Create and apply the edit
    await connection.workspace.applyEdit({
      changes: {
        [uri]: [{
          range: {
            start: { line, character: startPos },
            end: { line, character: endPos }
          },
          newText: newText
        }]
      }
    });

    // Trigger inlay hint refresh to clear the hint after conversion
    await connection.languages.inlayHint.refresh().catch((err) => {
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
  } else if (params.command === 'hledger.showWorkspaceGraph') {
    connection.console.log(`[ExecuteCommand] showWorkspaceGraph called. workspaceManager exists: ${!!workspaceManager}`);
    if (workspaceManager) {
      try {
        const graph = workspaceManager.getWorkspaceTree();
        connection.console.log(`[ExecuteCommand] Tree generated, length: ${graph.length}`);
        return graph;
      } catch (error) {
        connection.console.error(`[ExecuteCommand] Error generating tree: ${error}`);
        return `Error generating tree: ${error}`;
      }
    } else {
      connection.console.warn('[ExecuteCommand] Workspace manager not initialized');
      connection.window.showErrorMessage('Workspace manager not initialized');
      return 'Error: Workspace manager not initialized. Check LSP logs.';
    }
  } else if (params.command === 'hledger.showWorkspaceGraphStructured') {
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
      connection.window.showErrorMessage('Workspace manager not initialized');
      return [];
    }
  }
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

connection.console.log('========== HLEDGER LSP SERVER LISTENING ==========');
