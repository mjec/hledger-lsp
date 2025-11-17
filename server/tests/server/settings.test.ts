import { defaultSettings } from '../../src/server/settings';

describe('Settings', () => {
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
      expect(defaultSettings.validation?.undeclaredTags).toBe(true);
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
});
