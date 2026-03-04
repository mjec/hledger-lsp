#!/usr/bin/env node

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  TextDocumentPositionParams,
  DidChangeConfigurationNotification,
} from 'vscode-languageserver/node';

import { URI } from 'vscode-uri';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { handleCliArguments } from './server/cli';
import { registerLanguageFeatures } from './server/featureRegistry';
import { tokenTypes, tokenModifiers } from './features/semanticTokens';
import { validator } from './features/validator';
import { HledgerParser } from './parser/index';
import { HledgerSettings, defaultSettings, getDocumentSettings as getDocumentSettingsModule, clearDocumentSettings, clearAllDocumentSettings } from './server/settings';
import { defaultFileReader, resolveIncludePath as resolveIncludePathUtil, toFileUri } from './utils/uri';
import { updateDependencies, clearDependencies, getDependents } from './server/deps';
import { WorkspaceManager } from './server/workspace';
import * as path from 'path';
import { FileReader } from './types';
import { completionProvider } from './features/completion';

// Handle CLI arguments like --help, --version, --format
handleCliArguments();

// Create a connection for the server using Node's IPC as a transport
const connection = createConnection(ProposedFeatures.all);

connection.console.log('*========= HLEDGER LSP SERVER STARTING ==========');
// Diagnostic: print runtime filename and argv to verify which file is loaded by the EDH
try {
  // __filename points at the compiled JS file when running under Node
  connection.console.log(`SERVER RUNTIME __filename: ${__filename}`);
  connection.console.log(`SERVER PROCESS ARGV: ${process.argv.join(' ')}`);
} catch (e) {
  // ignore in environments where __filename isn't available
}

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasDidChangeConfigurationDynamicRegistration = false;
let hasInlayHintRefreshSupport = false;
let hasCodeLensRefreshSupport = false;

// Workspace state
let workspaceFolders: URI[] = [];
let workspaceManager: WorkspaceManager | null = null;

connection.onInitialize((params: InitializeParams) => {
  connection.console.log('========== ON INITIALIZE CALLED ==========');
  connection.console.log(`workspaceFolders: ${JSON.stringify(params.workspaceFolders)}`);

  // Get version from package.json
  let version = 'unknown';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const packageJson = require('../package.json');
    version = packageJson.version;
  } catch (error) {
    connection.console.warn('Failed to read version from package.json');
  }

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
  connection.console.log(`Dynamic registration for didChangeConfiguration support: ${hasDidChangeConfigurationDynamicRegistration}`);
  connection.console.log(`Configuration capability: ${hasConfigurationCapability}`)

  // Store workspace folders
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    workspaceFolders = params.workspaceFolders.map(folder => URI.parse(folder.uri));
  } else {
    // Fallback for clients that don't support workspaceFolders
    // rootUri is deprecated but kept for backward compatibility
    const legacyRootUri = params.rootUri;
    if (legacyRootUri) {
      workspaceFolders = [URI.parse(legacyRootUri)];
    }
  }

  const result: InitializeResult = {
    serverInfo: {
      name: 'hledger-lsp',
      version: version
    },
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
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
      callHierarchyProvider: true,
      executeCommandProvider: {
        commands: [
          'hledger.addBalanceAssertion',
          'hledger.insertBalanceAssertion',
          'hledger.insertInferredAmount',
          'hledger.convertToTotalCost',
          'hledger.refreshInlayHints',
          'hledger.showWorkspaceGraphStructured'
        ]
      }
    }
  };

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
async function initializeWorkspaceManager(folders: URI[], forceReinit: boolean = false): Promise<void> {
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
    // if (hasInlayHintRefreshSupport) {
    //   connection.languages.inlayHint.refresh();
    // }

    connection.console.log(`Refreshed ${openDocuments.length} open document(s) with workspace context`);
  } catch (error) {
    connection.console.error(`Failed to initialize WorkspaceManager: ${error}`);
    workspaceManager = null;
  }
}

// Global settings used when client does not support workspace/configuration
let globalSettings: HledgerSettings = defaultSettings;


// Create a shared parser instance with caching
const sharedParser = new HledgerParser();

// Small helper to centralize parsing options and reduce duplication across handlers
function parseDocument(
  document: TextDocument
) {
  const documentUri = URI.parse(document.uri);

  // Workspace mode: parse from root file for global state
  if (workspaceManager) {
    const root = workspaceManager.getRootForFile(documentUri);
    if (root) {
      // File is part of workspace tree - use cached workspace parse
      const parsed = workspaceManager.parseWorkspace();
      if (parsed) {
        return parsed;
      }
    }

    // No workspace root identified, but we can still parse from this file
    // and follow its includes using the pre-built include graph
    connection.console.info(
      `[parseDocument] No workspace root, parsing from file: ${document.uri}`
    );
    return workspaceManager.parseFromFile(documentUri);
  }

  // No workspace manager - fall back to document mode (single file only)
  connection.console.info(`[parseDocument] Document mode for ${document.uri}`);
  return sharedParser.parse(document);
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
function getDocumentSettings(resource: URI): Thenable<HledgerSettings> {
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
    const uri: URI = URI.parse(e.document.uri);
    const filePath = uri.fsPath;
    const dirPath = path.dirname(filePath);
    const workspaceUri = toFileUri(dirPath);


    connection.console.log(`Lazy-initializing WorkspaceManager with directory: ${workspaceUri}`);
    await initializeWorkspaceManager([workspaceUri]);
  }

  // Validate the newly opened document
  // Note: If workspace was just initialized above, this document was already validated
  // during initialization, but it's harmless to validate again
  await validateTextDocument(e.document);
});

// Only keep settings for open documents
documents.onDidClose(e => {
  clearDocumentSettings(URI.parse(e.document.uri));
  clearDependencies(URI.parse(e.document.uri));
});

// The content of a text document has changed
documents.onDidChangeContent(change => {
  connection.console.info(`[Document Change] ${change.document.uri} (version: ${change.document.version})`);


  // Invalidate workspace cache for affected roots
  if (workspaceManager) {
    workspaceManager.invalidateFile(URI.parse(change.document.uri));
  }

  validateTextDocument(change.document);

  // Re-validate all files that depend on this one
  const dependents = getDependents(URI.parse(change.document.uri));
  if (dependents) {
    for (const dependentUri of dependents) {
      const dependentDoc = getDocument(dependentUri.toString());
      if (dependentDoc) {
        validateTextDocument(dependentDoc);
      }
    }
  }

  // Refresh inlay hints after any document change
  // This ensures positions update correctly when lines are added/removed
  // and that workspace-wide state (running balances, etc.) stays in sync
  if (hasInlayHintRefreshSupport) {
    connection.languages.inlayHint.refresh();
  }

  // In workspace mode, changes to one file affect all files in the workspace
  // (e.g., running balances, transaction counts, completions)
  // Re-validate other open documents that share the same root
  if (workspaceManager) {
    const changedRoot = workspaceManager.getRootForFile(URI.parse(change.document.uri));

    if (changedRoot) {
      // Find all open documents that share the same root (excluding the current one, which was already validated)
      const allDocs = documents.all();

      const affectedDocs = allDocs.filter(doc => {
        const docRoot = workspaceManager!.getRootForFile(URI.parse(doc.uri));
        const isSameRoot = docRoot === changedRoot;
        // Normalize URIs for comparison to handle encoding differences
        const isDifferentFile = URI.parse(doc.uri).toString() !== URI.parse(change.document.uri).toString();
        return isSameRoot && isDifferentFile;
      });

      // Re-validate affected documents (updates diagnostics)
      if (affectedDocs.length > 0) {
        connection.console.log(`[Cascade Validation] Revalidating ${affectedDocs.length} affected document(s)`);
        for (const doc of affectedDocs) {
          validateTextDocument(doc);
        }
      }

      // Note: Inlay hints refresh above already covers all documents
      // Code lenses will refresh when the client next requests them
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

/**
 * Helper function to get a document from the collection with fuzzy URI matching
 * Handles differences in URI encoding between VSCode and Neovim
 */
function getDocument(uri: string): TextDocument | undefined {
  // Try 1: Exact match
  let doc = documents.get(uri);
  if (doc) return doc;

  // Try 2: Normalized URI
  const normalized = URI.parse(uri).toString();
  if (normalized !== uri) {
    doc = documents.get(normalized);
    if (doc) return doc;
  }

  // Try 3: Search all documents with normalized comparison
  for (const openDoc of documents.all()) {
    if (URI.parse(openDoc.uri).toString() === normalized) {
      return openDoc;
    }
  }

  return undefined;
}

// Create a file reader that uses in-memory documents when available
// This ensures we see unsaved changes in the editor
const fileReader: FileReader = (uri: URI) => {
  const uriString = uri.toString();

  // Try to find the document with fuzzy URI matching
  const openDoc = getDocument(uriString);
  if (openDoc) {
    connection.console.debug(`[FileReader] Using in-memory document: ${uriString} (version: ${openDoc.version})`);
    return openDoc;
  }

  // Fall back to reading from disk
  connection.console.debug(`[FileReader] Reading from disk: ${uriString} (not found in ${documents.all().length} open documents)`);
  return defaultFileReader(uri);
};

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // Get document settings
  const settings = (await getDocumentSettings(URI.parse(textDocument.uri))) ?? defaultSettings;

  // Validation needs workspace state for balance assertions and full transaction history
  const parsedDoc = parseDocument(textDocument);
  // Track which files this document includes
  const includedFiles = new Set<URI>();
  for (const directive of parsedDoc.directives) {
    if (directive.type === 'include') {
      const resolvedPath = resolveIncludePathUtil(directive.value, URI.parse(textDocument.uri));
      includedFiles.add(resolvedPath);
    }
  }
  updateDependencies(URI.parse(textDocument.uri), includedFiles);

  // Update completion data from the parsed document (includes all workspace files)
  completionProvider.updateAccounts(parsedDoc.accounts);
  completionProvider.updatePayees(parsedDoc.payees);
  completionProvider.updateCommodities(parsedDoc.commodities);
  completionProvider.updateTags(parsedDoc.tags);

  // Validate the document with settings
  const validationResult = validator.validate(textDocument, parsedDoc, {
    baseUri: URI.parse(textDocument.uri),
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

// Ensure the feature registry bindings are created
registerLanguageFeatures({
  connection,
  documents,
  getWorkspaceManager: () => workspaceManager,
  sharedParser,
  fileReader,
  hasConfigurationCapability,
  hasInlayHintRefreshSupport,
  getDocument,
  parseDocument,
  getDocumentSettings
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

connection.console.log('========== HLEDGER LSP SERVER LISTENING ==========');
