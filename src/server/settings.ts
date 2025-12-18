import { Connection } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';

// Deep partial type for nested objects
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface HledgerSettings {
  maxNumberOfProblems: number;
  hledgerPath: string;
  validation: {
    balance: boolean;
    missingAmounts: boolean;
    undeclaredAccounts: boolean;
    undeclaredPayees: boolean;
    undeclaredCommodities: boolean;
    undeclaredTags: boolean;
    dateOrdering: boolean;
    balanceAssertions: boolean;
    emptyTransactions: boolean;
    invalidDates: boolean;
    futureDates: boolean;
    emptyDescriptions: boolean;
    includeFiles: boolean;
    circularIncludes: boolean;
    markAllUndeclaredInstances: boolean;
  };
  severity: {
    undeclaredAccounts: 'error' | 'warning' | 'information' | 'hint';
    undeclaredPayees: 'error' | 'warning' | 'information' | 'hint';
    undeclaredCommodities: 'error' | 'warning' | 'information' | 'hint';
    undeclaredTags: 'error' | 'warning' | 'information' | 'hint';
  };
  include: {
    followIncludes: boolean;
    maxDepth: number;
  };
  completion: {
    onlyDeclaredAccounts: boolean;
    onlyDeclaredPayees: boolean;
    onlyDeclaredCommodities: boolean;
    onlyDeclaredTags: boolean;
  };
  formatting: {
    indentation: number;
    maxAccountWidth: number;
    maxCommodityWidth: number;
    maxAmountWidth: number;
    minSpacing: number;
    decimalAlignColumn: number;
    assertionDecimalAlignColumn: number;
    signPosition: 'before-symbol' | 'after-symbol';
    showPositivesSign: boolean;
  };
  inlayHints: {
    showInferredAmounts: boolean;
    showRunningBalances: boolean;
    showCostConversions: boolean;
  };
  codeLens: {
    showTransactionCounts: boolean;
  };
  workspace: {
    enabled: boolean;
    eagerParsing: boolean;
    autoDetectRoot: boolean;
  };
}

// Export type aliases for each settings subsection to avoid duplication
export type FormattingOptions = HledgerSettings['formatting'];
export type ValidationOptions = HledgerSettings['validation'];
export type SeverityOptions = HledgerSettings['severity'];
export type IncludeOptions = HledgerSettings['include'];
export type CompletionOptions = HledgerSettings['completion'];
export type InlayHintsOptions = HledgerSettings['inlayHints'];
export type CodeLensOptions = HledgerSettings['codeLens'];
export type WorkspaceOptions = HledgerSettings['workspace'];

export const defaultSettings: HledgerSettings = {
  maxNumberOfProblems: 1000,
  hledgerPath: 'hledger',
  validation: {
    balance: true,
    missingAmounts: true,
    undeclaredAccounts: true,
    undeclaredPayees: false,
    undeclaredCommodities: true,
    undeclaredTags: false,
    dateOrdering: true,
    balanceAssertions: true,
    emptyTransactions: true,
    invalidDates: true,
    futureDates: true,
    emptyDescriptions: true,
    includeFiles: true,
    circularIncludes: true,
    markAllUndeclaredInstances: true,
  },
  severity: {
    undeclaredAccounts: 'warning',
    undeclaredPayees: 'warning',
    undeclaredCommodities: 'warning',
    undeclaredTags: 'information',
  },
  include: {
    followIncludes: true,
    maxDepth: 10,
  },
  completion: {
    onlyDeclaredAccounts: true,
    onlyDeclaredPayees: true,
    onlyDeclaredCommodities: true,
    onlyDeclaredTags: true,
  },
  formatting: {
    indentation: 4,
    maxAccountWidth: 42,
    maxCommodityWidth: 4,
    maxAmountWidth: 12,
    minSpacing: 2,
    decimalAlignColumn: 52,
    assertionDecimalAlignColumn: 70,
    signPosition: 'after-symbol',
    showPositivesSign: false,
  },
  inlayHints: {
    showInferredAmounts: true,
    showRunningBalances: false,
    showCostConversions: true,
  },
  codeLens: {
    showTransactionCounts: false,
  },
  workspace: {
    enabled: true,
    eagerParsing: true,
    autoDetectRoot: true,
  }
};

// Export default options for each subsection (extracted from defaultSettings to avoid duplication)
export const DEFAULT_FORMATTING_OPTIONS = defaultSettings.formatting;
export const DEFAULT_VALIDATION_OPTIONS = defaultSettings.validation;
export const DEFAULT_SEVERITY_OPTIONS = defaultSettings.severity;
export const DEFAULT_INCLUDE_OPTIONS = defaultSettings.include;
export const DEFAULT_COMPLETION_OPTIONS = defaultSettings.completion;
export const DEFAULT_INLAY_HINTS_OPTIONS = defaultSettings.inlayHints;
export const DEFAULT_CODE_LENS_OPTIONS = defaultSettings.codeLens;
export const DEFAULT_WORKSPACE_OPTIONS = defaultSettings.workspace;

// Cache the settings of all open documents
const documentSettings: Map<URI, Thenable<HledgerSettings>> = new Map();

/**
 * Deep merge two objects, with values from 'source' overriding 'target'
 */
export function deepMerge<T extends Record<string, any>>(target: T, source: DeepPartial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (sourceValue !== undefined && targetValue !== undefined &&
        typeof sourceValue === 'object' && typeof targetValue === 'object' &&
        !Array.isArray(sourceValue) && !Array.isArray(targetValue)) {
        (result as any)[key] = deepMerge(targetValue, sourceValue);
      } else if (sourceValue !== undefined) {
        (result as any)[key] = sourceValue;
      }
    }
  }

  return result;
}

/**
 * Get settings for a document. If the client does not support workspace/configuration
 * the default settings are returned.
 */
export function getDocumentSettings(connection: Connection, resource: URI, hasConfigurationCapability: boolean): Thenable<HledgerSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(defaultSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource.toString(),
      section: 'hledgerLanguageServer'
    }).then((userSettings) => {
      // Merge user settings with defaults so unspecified settings use default values
      const merged = deepMerge(defaultSettings, userSettings || {});

      // connection.console.log(`Loaded hledgerLanguageServer settings for ${resource.toString()}`);

      return merged;
    });
    documentSettings.set(resource, result);
  }
  return result;
}

export function clearDocumentSettings(resource: URI): void {
  documentSettings.delete(resource);
}

export function clearAllDocumentSettings(): void {
  documentSettings.clear();
}
