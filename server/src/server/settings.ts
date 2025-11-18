import { Connection } from 'vscode-languageserver/node';

export interface HledgerSettings {
  maxNumberOfProblems: number;
  hledgerPath?: string;
  validation?: {
    balance?: boolean;
    missingAmounts?: boolean;
    undeclaredAccounts?: boolean;
    undeclaredPayees?: boolean;
    undeclaredCommodities?: boolean;
    undeclaredTags?: boolean;
    dateOrdering?: boolean;
    balanceAssertions?: boolean;
    emptyTransactions?: boolean;
    invalidDates?: boolean;
    futureDates?: boolean;
    emptyDescriptions?: boolean;
    includeFiles?: boolean;
    circularIncludes?: boolean;
    markAllUndeclaredInstances?: boolean;
  };
  severity?: {
    undeclaredAccounts?: 'error' | 'warning' | 'information' | 'hint';
    undeclaredPayees?: 'error' | 'warning' | 'information' | 'hint';
    undeclaredCommodities?: 'error' | 'warning' | 'information' | 'hint';
    undeclaredTags?: 'error' | 'warning' | 'information' | 'hint';
  };
  include?: {
    followIncludes?: boolean;
    maxDepth?: number;
  };
  completion?: {
    onlyDeclaredAccounts?: boolean;
    onlyDeclaredPayees?: boolean;
    onlyDeclaredCommodities?: boolean;
    onlyDeclaredTags?: boolean;
  };
  formatting?: {
    indentation?: number;
    maxAccountWidth?: number;
    maxCommodityWidth?: number;
    maxAmountWidth?: number;
    minSpacing?: number;
    decimalAlignColumn?: number;
    assertionDecimalAlignColumn?: number;
  };
  inlayHints?: {
    showInferredAmounts?: boolean;
    showRunningBalances?: boolean;
    showCostConversions?: boolean;
  };
}

export const defaultSettings: HledgerSettings = {
  maxNumberOfProblems: 1000,
  hledgerPath: 'hledger',
  validation: {
    balance: true,
    missingAmounts: true,
    undeclaredAccounts: true,
    undeclaredPayees: false,
    undeclaredCommodities: true,
    undeclaredTags: true,
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
  },
  inlayHints: {
    showInferredAmounts: true,
    showRunningBalances: true,
    showCostConversions: true,
  }
};

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<HledgerSettings>> = new Map();

/**
 * Deep merge two objects, with values from 'source' overriding 'target'
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
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
export function getDocumentSettings(connection: Connection, resource: string, hasConfigurationCapability: boolean): Thenable<HledgerSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(defaultSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'hledgerLanguageServer'
    }).then((userSettings) => {
      // Merge user settings with defaults so unspecified settings use default values
      const merged = deepMerge(defaultSettings, userSettings || {});
      // Lightweight log to verify that configuration is flowing from the client
      connection.console.log(
        `Loaded hledgerLanguageServer settings for ${resource}: ${JSON.stringify(userSettings || {})}`
      );
      return merged;
    });
    documentSettings.set(resource, result);
  }
  return result;
}

export function clearDocumentSettings(resource: string): void {
  documentSettings.delete(resource);
}

export function clearAllDocumentSettings(): void {
  documentSettings.clear();
}
