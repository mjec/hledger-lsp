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
import { findReferencesProvider } from './features/findReferences';
import { validator } from './features/validator';
import { foldingRangesProvider } from './features/foldingRanges';
import { documentLinksProvider } from './features/documentLinks';
import { selectionRangeProvider } from './features/selectionRange';
import { HledgerParser, FileReader } from './parser/index';
import { HledgerSettings, defaultSettings, getDocumentSettings as getDocumentSettingsModule, clearDocumentSettings, clearAllDocumentSettings } from './server/settings';
import { defaultFileReader, resolveIncludePath as resolveIncludePathUtil } from './utils/uri';

// Create a connection for the server using Node's IPC as a transport
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let hasDidChangeConfigurationDynamicRegistration = false;
let hasWorkspaceFoldersDynamicRegistration = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );
  // Check if client supports dynamic registration for didChangeConfiguration
  hasDidChangeConfigurationDynamicRegistration = !!(
    capabilities.workspace &&
    capabilities.workspace.didChangeConfiguration &&
    capabilities.workspace.didChangeConfiguration.dynamicRegistration
  );
  // Check if client supports dynamic registration for workspace folders
  // (Not currently used, kept for future reference)
  hasWorkspaceFoldersDynamicRegistration = false;

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
      renameProvider: {
        prepareProvider: true
      },
      foldingRangeProvider: true,
      documentLinkProvider: {
        resolveProvider: false
      },
      selectionRangeProvider: true
    }
  };

  // Note: Workspace folders support removed to avoid warnings with clients
  // that don't support dynamic registration (like Neovim)

  return result;
});

connection.onInitialized(() => {
  // Only use dynamic registration if the client supports it
  if (hasConfigurationCapability && hasDidChangeConfigurationDynamicRegistration) {
    // Register for all configuration changes dynamically
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }

  connection.console.log('hledger Language Server initialized');
});

// Global settings used when client does not support workspace/configuration
let globalSettings: HledgerSettings = defaultSettings;

// include dependency functions are centralized in src/server/deps.ts
import { updateDependencies, clearDependencies, getDependents } from './server/deps';

// Create a shared parser instance with caching
const sharedParser = new HledgerParser();

// Small helper to centralize parsing options and reduce duplication across handlers
function parseDocument(document: TextDocument) {
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
});

// dependency tracking moved to src/server/deps.ts

// Use centralized file reader implementation
const fileReader: FileReader = defaultFileReader;

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // Get document settings
  const settings = (await getDocumentSettings(textDocument.uri)) ?? defaultSettings;

  // Parse the document with includes enabled (uses shared parser with caching)
  const parsedDoc = parseDocument(textDocument);

  // Track which files this document includes
  const includedFiles = new Set<string>();
  for (const directive of parsedDoc.directives) {
    if (directive.type === 'include') {
      const resolvedPath = resolveIncludePathUtil(directive.value, textDocument.uri);
      includedFiles.add(resolvedPath);
    }
  }
  updateDependencies(textDocument.uri, includedFiles);

  // Update completion data from the parsed document (includes all included files)
  completionProvider.updateAccounts(parsedDoc.accounts.map(a => ({ name: a.name, declared: a.declared })));
  completionProvider.updatePayees(parsedDoc.payees.map(p => ({ name: p.name, declared: p.declared })));
  completionProvider.updateCommodities(parsedDoc.commodities.map(c => ({ name: c.name, declared: c.declared })));
  completionProvider.updateTags(parsedDoc.tags.map(t => ({ name: t.name, declared: t.declared })));

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

      // Parse document for smart completions
      const parsed = parseDocument(document);

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
connection.onHover((params, token) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const parsed = parseDocument(document);

  const hover = hoverProvider.provideHover(document, params.position.line, params.position.character, parsed);
  return hover;
});

// Provide definition locations (go-to-definition)
connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  // Parse document with includes using server's fileReader
  const parsed = parseDocument(document);

  const loc = definitionProvider.provideDefinition(document, params.position.line, params.position.character, parsed);
  return loc ? [loc] : null;
});

// Provide references (find all usages)
connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  // Parse document with includes using server's fileReader
  const parsed = parseDocument(document);

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

    // Parse document
    const parsed = parseDocument(document);

    // Get settings for inlay hints
    const settings = await getDocumentSettings(params.textDocument.uri);
    const inlayHintsSettings = settings?.inlayHints || undefined;

    return inlayHintsProvider.provideInlayHints(
      document,
      params.range,
      parsed,
      inlayHintsSettings
    );
  } catch (error) {
    connection.console.error(`Error providing inlay hints: ${error}`);
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

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();
