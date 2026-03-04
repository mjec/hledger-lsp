/**
 * Validator for hledger journal files
 *
 * Provides validation for:
 * - Transaction balance
 * - Undeclared items (accounts, payees, commodities, tags)
 * - Missing amounts
 * - Include directives
 */

import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument } from '../types';
import { ValidationOptions, defaultSettings } from '../server/settings';
import { ValidatorOptions, ValidationResult } from './validation/types';
import { getLineRange } from './validation/utils';
import {
  validateBalance,
  validatePeriodicTransactionBalance,
  validateExplicitCosts,
  validateMissingAmounts,
  validatePeriodicTransactionMissingAmounts,
  validateEmptyTransaction,
  validateEmptyDescription,
  validateDateFormat,
  validateFutureDate,
  validateDateOrdering,
  validateBalanceAssertions,
  validateIncludeDirectives,
  validateFormatMismatch,
  validateUndeclaredItems
} from './validation/index';

export { ValidationResult, ValidatorOptions };

export class Validator {
  /**
   * Validate a parsed hledger document
   */
  validate(document: TextDocument, parsedDoc: ParsedDocument, options?: ValidatorOptions): ValidationResult {
    const diagnostics: Diagnostic[] = [];
    const settings = options?.settings;

    // Normalize document URI to ensure proper encoding (e.g., @ -> %40)
    // This fixes issues where clients (like Neovim) send partially-encoded URIs
    const documentUri = URI.parse(document.uri).toString();

    // Helper to check if validation is enabled
    // Uses provided settings, or falls back to default settings
    const isEnabled = (key: keyof ValidationOptions): boolean => {
      // If settings are provided, use them
      if (settings?.validation?.[key] !== undefined) {
        return settings.validation[key] === true;
      }
      // Otherwise use defaults
      return defaultSettings.validation[key];
    };


    // Validate each transaction
    for (const transaction of parsedDoc.transactions) {
      // Only validate transactions in the current document
      // (workspace parsing may include transactions from other files)
      if (transaction.sourceUri?.toString() !== documentUri) {
        continue;
      }

      // Check balance
      if (isEnabled('balance')) {
        const balanceIssues = validateBalance(transaction, document, parsedDoc);
        diagnostics.push(...balanceIssues);
      }

      // Check for implicit cost inference (strict "balanced" mode)
      if (isEnabled('requireExplicitCosts')) {
        const costIssues = validateExplicitCosts(transaction, document);
        diagnostics.push(...costIssues);
      }

      // Check missing amounts
      if (isEnabled('missingAmounts')) {
        const amountIssues = validateMissingAmounts(transaction, document);
        diagnostics.push(...amountIssues);
      }

      // Check empty transactions
      if (isEnabled('emptyTransactions')) {
        const emptyTxnIssues = validateEmptyTransaction(transaction, document);
        diagnostics.push(...emptyTxnIssues);
      }

      // Check invalid date formats
      if (isEnabled('invalidDates')) {
        const invalidDateIssues = validateDateFormat(transaction, document);
        diagnostics.push(...invalidDateIssues);
      }

      // Check future dates
      if (isEnabled('futureDates')) {
        const futureDateIssues = validateFutureDate(transaction, document);
        diagnostics.push(...futureDateIssues);
      }

      // Check empty descriptions
      if (isEnabled('emptyDescriptions')) {
        const emptyDescIssues = validateEmptyDescription(transaction, document);
        diagnostics.push(...emptyDescIssues);
      }

      // Check format mismatches
      if (isEnabled('formatMismatch')) {
        const formatIssues = validateFormatMismatch(transaction, document, parsedDoc, settings);
        diagnostics.push(...formatIssues);
      }
    }

    // Validate periodic transactions
    for (const periodicTx of parsedDoc.periodicTransactions) {
      if (periodicTx.sourceUri?.toString() !== documentUri) {
        continue;
      }

      // Check balance (periodic transactions must balance like regular ones)
      if (isEnabled('balance')) {
        const balanceIssues = validatePeriodicTransactionBalance(periodicTx, document, parsedDoc);
        diagnostics.push(...balanceIssues);
      }

      // Check missing amounts
      if (isEnabled('missingAmounts')) {
        const amountIssues = validatePeriodicTransactionMissingAmounts(periodicTx, document);
        diagnostics.push(...amountIssues);
      }

      // Check empty (must have postings)
      if (isEnabled('emptyTransactions')) {
        if (periodicTx.postings.length === 0 && periodicTx.line !== undefined) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: getLineRange(periodicTx.line, document),
            message: 'Periodic transaction has no postings',
            source: 'hledger'
          });
        }
      }
    }

    // Validate auto postings (minimal — they are partial by design)
    for (const autoPost of parsedDoc.autoPostings) {
      if (autoPost.sourceUri?.toString() !== documentUri) {
        continue;
      }
      // No balance validation for auto postings — they are partial by design
      // Undeclared accounts/commodities are handled by the general undeclared items check
    }

    // Check for undeclared items (each type can be enabled/disabled separately)
    const undeclaredIssues = validateUndeclaredItems(
      document,
      parsedDoc,
      settings,
      isEnabled('undeclaredAccounts'),
      isEnabled('undeclaredPayees'),
      isEnabled('undeclaredCommodities'),
      isEnabled('undeclaredTags')
    );
    diagnostics.push(...undeclaredIssues);

    // Check date ordering
    if (isEnabled('dateOrdering')) {
      const dateOrderIssues = validateDateOrdering(parsedDoc.transactions, document);
      diagnostics.push(...dateOrderIssues);
    }

    // Check balance assertions
    if (isEnabled('balanceAssertions')) {
      const assertionIssues = validateBalanceAssertions(parsedDoc.transactions, document, parsedDoc);
      diagnostics.push(...assertionIssues);
    }

    // Check include directives
    if (options?.fileReader && (isEnabled('includeFiles') || isEnabled('circularIncludes'))) {
      const includeIssues = validateIncludeDirectives(document, parsedDoc, options, isEnabled('includeFiles'), isEnabled('circularIncludes'));
      diagnostics.push(...includeIssues);
    }

    return { diagnostics };
  }
}

export const validator = new Validator();
