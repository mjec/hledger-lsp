import { defaultSettings, deepMerge, getDocumentSettings, clearDocumentSettings, clearAllDocumentSettings } from '../../src/server/settings';
import { URI } from 'vscode-uri';

describe('Settings', () => {
  beforeEach(() => {
    // Clear all cached settings before each test to avoid state pollution
    clearAllDocumentSettings();
  });

  describe('defaultSettings', () => {
    test('should have undeclaredPayees validation disabled by default', () => {
      expect(defaultSettings.validation?.undeclaredPayees).toBe(false);
    });

    test('should have undeclaredAccounts validation enabled by default', () => {
      expect(defaultSettings.validation?.undeclaredAccounts).toBe(true);
    });

    test('should have undeclaredCommodities validation enabled by default', () => {
      expect(defaultSettings.validation?.undeclaredCommodities).toBe(true);
    });

    test('should have undeclaredTags validation enabled by default', () => {
      expect(defaultSettings.validation?.undeclaredTags).toBe(false);
    });

    test('should have all other validations enabled by default', () => {
      expect(defaultSettings.validation?.balance).toBe(true);
      expect(defaultSettings.validation?.missingAmounts).toBe(true);
      expect(defaultSettings.validation?.dateOrdering).toBe(true);
      expect(defaultSettings.validation?.balanceAssertions).toBe(true);
      expect(defaultSettings.validation?.emptyTransactions).toBe(true);
      expect(defaultSettings.validation?.invalidDates).toBe(true);
      expect(defaultSettings.validation?.futureDates).toBe(true);
      expect(defaultSettings.validation?.emptyDescriptions).toBe(true);
      expect(defaultSettings.validation?.includeFiles).toBe(true);
      expect(defaultSettings.validation?.circularIncludes).toBe(true);
    });
  });

  describe('deepMerge', () => {
    test('should merge flat objects', () => {
      const target = { a: 1, b: 2, c: 3 };
      const source = { b: 20, d: 4 };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 20, c: 3, d: 4 });
    });

    test('should merge nested objects', () => {
      const target = {
        validation: {
          balance: true,
          undeclaredAccounts: true
        },
        maxNumberOfProblems: 100
      };
      const source: Partial<typeof target> = {
        validation: {
          balance: false
        } as any
      };
      const result = deepMerge(target, source);

      expect(result).toEqual({
        validation: {
          balance: false,
          undeclaredAccounts: true
        },
        maxNumberOfProblems: 100
      });
    });

    test('should handle deeply nested objects', () => {
      const target = {
        level1: {
          level2: {
            level3: {
              value: 'original'
            }
          }
        }
      };
      const source: Partial<typeof target> = {
        level1: {
          level2: {
            level3: {
              value: 'updated'
            }
          }
        } as any
      };
      const result = deepMerge(target, source);

      expect(result.level1.level2.level3.value).toBe('updated');
    });

    test('should not mutate target object', () => {
      const target = { a: 1, b: { c: 2 } };
      const source: Partial<typeof target> = { b: { c: 3 } as any };
      const result = deepMerge(target, source);

      expect(target.b.c).toBe(2); // Original unchanged
      expect(result.b.c).toBe(3); // Result has new value
    });

    test('should handle undefined source values', () => {
      const target = { a: 1, b: 2 };
      const source = { b: undefined };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 2 }); // b should remain unchanged
    });

    test('should override arrays rather than merging them', () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [4, 5] };
      const result = deepMerge(target, source);

      expect(result.items).toEqual([4, 5]); // Source array replaces target array
    });

    test('should handle primitive value overrides', () => {
      const target = { value: 'original' };
      const source = { value: 'updated' };
      const result = deepMerge(target, source);

      expect(result.value).toBe('updated');
    });

    test('should handle object replacing primitive', () => {
      const target = { value: 'string' } as any;
      const source = { value: { nested: true } };
      const result = deepMerge(target, source);

      expect(result.value).toEqual({ nested: true });
    });

    test('should handle primitive replacing object', () => {
      const target = { value: { nested: true } } as any;
      const source = { value: 'string' };
      const result = deepMerge(target, source);

      expect(result.value).toBe('string');
    });

    test('should merge real HledgerSettings structure', () => {
      const result = deepMerge(defaultSettings, {
        validation: {
          balance: false,
          undeclaredPayees: true
        },
        severity: {
          undeclaredAccounts: 'error' as const
        }
      });

      expect(result.validation?.balance).toBe(false);
      expect(result.validation?.undeclaredPayees).toBe(true);
      expect(result.validation?.undeclaredAccounts).toBe(true); // Unchanged
      expect(result.severity?.undeclaredAccounts).toBe('error');
      expect(result.severity?.undeclaredPayees).toBe('warning'); // Unchanged
    });
  });

  describe('getDocumentSettings', () => {
    test('should return default settings when configuration capability is false', async () => {
      const mockConnection = {} as any;
      const resource = URI.parse('file:///test.journal');
      const hasConfigCapability = false;

      const result = await getDocumentSettings(mockConnection, resource, hasConfigCapability);

      expect(result).toEqual(defaultSettings);
    });

    test('should fetch and cache settings when configuration capability is true', async () => {
      const mockUserSettings = {
        validation: {
          balance: false
        }
      };

      const mockConnection = {
        workspace: {
          getConfiguration: jest.fn().mockResolvedValue(mockUserSettings)
        },
        console: {
          log: jest.fn(),
          debug: jest.fn()
        }
      } as any;

      const resource = URI.parse('file:///test.journal');
      const hasConfigCapability = true;

      const result = await getDocumentSettings(mockConnection, resource, hasConfigCapability);

      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledWith({
        scopeUri: resource.toString(),
        section: 'hledgerLanguageServer'
      });
      expect(result.validation?.balance).toBe(false);
      expect(result.validation?.undeclaredAccounts).toBe(true); // From defaults
    });

    test('should use cached settings on subsequent calls', async () => {
      const mockUserSettings = {
        validation: {
          balance: false
        }
      };

      const mockConnection = {
        workspace: {
          getConfiguration: jest.fn().mockResolvedValue(mockUserSettings)
        },
        console: {
          log: jest.fn(),
          debug: jest.fn()
        }
      } as any;

      const resource = URI.parse('file:///cached.journal');
      const hasConfigCapability = true;

      // First call
      const result1 = await getDocumentSettings(mockConnection, resource, hasConfigCapability);

      // Second call
      const result2 = await getDocumentSettings(mockConnection, resource, hasConfigCapability);

      // Should only call getConfiguration once
      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });

    test('should handle null user settings', async () => {
      const mockConnection = {
        workspace: {
          getConfiguration: jest.fn().mockResolvedValue(null)
        },
        console: {
          log: jest.fn(),
          debug: jest.fn()
        }
      } as any;

      const resource = URI.parse('file:///test.journal');
      const hasConfigCapability = true;

      const result = await getDocumentSettings(mockConnection, resource, hasConfigCapability);

      expect(result).toEqual(defaultSettings);
    });


  });

  describe('clearDocumentSettings', () => {
    test('should clear settings for a specific document', async () => {
      const mockConnection = {
        workspace: {
          getConfiguration: jest.fn().mockResolvedValue({})
        },
        console: {
          log: jest.fn(),
          debug: jest.fn()
        }
      } as any;

      const resource = URI.parse('file:///test.journal');

      // First, get settings to populate cache
      await getDocumentSettings(mockConnection, resource, true);
      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(1);

      // Clear the settings
      clearDocumentSettings(resource);

      // Get settings again - should fetch from server again
      await getDocumentSettings(mockConnection, resource, true);
      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(2);
    });
  });

  // These tests demonstrate that the settings cache must work when callers
  // use different URI.parse() instances for the same URI string, matching
  // real usage in server.ts and featureRegistry.ts.
  describe('URI identity: cache lookups with separately parsed URIs', () => {
    test('should use cached settings when looked up with a different URI.parse() instance', async () => {
      const mockConnection = {
        workspace: {
          getConfiguration: jest.fn().mockResolvedValue({ validation: { balance: false } })
        },
        console: {
          log: jest.fn(),
          debug: jest.fn()
        }
      } as any;

      const uri = 'file:///home/user/ledger/main.journal';

      // First call populates cache with one URI.parse() instance
      await getDocumentSettings(mockConnection, URI.parse(uri), true);

      // Second call with a fresh URI.parse() instance should hit cache
      await getDocumentSettings(mockConnection, URI.parse(uri), true);

      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(1);
    });

    test('clearDocumentSettings with a fresh URI.parse() should clear cached entry', async () => {
      const mockConnection = {
        workspace: {
          getConfiguration: jest.fn().mockResolvedValue({})
        },
        console: {
          log: jest.fn(),
          debug: jest.fn()
        }
      } as any;

      const uri = 'file:///home/user/ledger/main.journal';

      // Populate cache
      await getDocumentSettings(mockConnection, URI.parse(uri), true);
      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(1);

      // Clear with a fresh URI.parse() instance
      clearDocumentSettings(URI.parse(uri));

      // Should fetch again because cache was cleared
      await getDocumentSettings(mockConnection, URI.parse(uri), true);
      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearAllDocumentSettings', () => {
    test('should clear all document settings', async () => {
      const mockConnection = {
        workspace: {
          getConfiguration: jest.fn().mockResolvedValue({})
        },
        console: {
          log: jest.fn(),
          debug: jest.fn()
        }
      } as any;

      const resource1 = URI.parse('file:///test1.journal');
      const resource2 = URI.parse('file:///test2.journal');

      // Get settings for multiple documents
      await getDocumentSettings(mockConnection, resource1, true);
      await getDocumentSettings(mockConnection, resource2, true);
      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(2);

      // Clear all settings
      clearAllDocumentSettings();

      // Get settings again - should fetch from server again for both
      await getDocumentSettings(mockConnection, resource1, true);
      await getDocumentSettings(mockConnection, resource2, true);
      expect(mockConnection.workspace.getConfiguration).toHaveBeenCalledTimes(4);
    });
  });
});
