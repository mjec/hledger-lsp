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
import { isFromDocument } from '../utils/index';
import { ValidationOptions, defaultSettings } from '../server/settings';
import { ValidatorOptions, ValidationResult } from './validation/types';
import { getLineRange } from './validation/utils';
import {
  validateNonPeriodicBalance,
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

    // Split document text once for all validation functions
    const lines = document.getText().split('\n');

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
      if (!isFromDocument(transaction, documentUri)) {
        continue;
      }

      // Check balance
      if (isEnabled('balance')) {
        const balanceIssues = validateNonPeriodicBalance(transaction, lines, parsedDoc);
        diagnostics.push(...balanceIssues);
      }

      // Check for implicit cost inference (strict "balanced" mode)
      if (isEnabled('requireExplicitCosts')) {
        const costIssues = validateExplicitCosts(transaction, lines);
        diagnostics.push(...costIssues);
      }

      // Check missing amounts
      if (isEnabled('missingAmounts')) {
        const amountIssues = validateMissingAmounts(transaction, lines);
        diagnostics.push(...amountIssues);
      }

      // Check empty transactions
      if (isEnabled('emptyTransactions')) {
        const emptyTxnIssues = validateEmptyTransaction(transaction, lines);
        diagnostics.push(...emptyTxnIssues);
      }

      // Check invalid date formats
      if (isEnabled('invalidDates')) {
        const invalidDateIssues = validateDateFormat(transaction, lines);
        diagnostics.push(...invalidDateIssues);
      }

      // Check future dates
      if (isEnabled('futureDates')) {
        const futureDateIssues = validateFutureDate(transaction, lines);
        diagnostics.push(...futureDateIssues);
      }

      // Check empty descriptions
      if (isEnabled('emptyDescriptions')) {
        const emptyDescIssues = validateEmptyDescription(transaction, lines);
        diagnostics.push(...emptyDescIssues);
      }

      // Check format mismatches
      if (isEnabled('formatMismatch')) {
        const formatIssues = validateFormatMismatch(transaction, lines, parsedDoc, settings);
        diagnostics.push(...formatIssues);
      }
    }

    // Validate periodic transactions
    for (const periodicTx of parsedDoc.periodicTransactions) {
      if (!isFromDocument(periodicTx, documentUri)) {
        continue;
      }

      // Check balance (periodic transactions must balance like regular ones)
      if (isEnabled('balance')) {
        const balanceIssues = validatePeriodicTransactionBalance(periodicTx, lines, parsedDoc);
        diagnostics.push(...balanceIssues);
      }

      // Check missing amounts
      if (isEnabled('missingAmounts')) {
        const amountIssues = validatePeriodicTransactionMissingAmounts(periodicTx, lines);
        diagnostics.push(...amountIssues);
      }

      // Check empty (must have postings)
      if (isEnabled('emptyTransactions')) {
        if (periodicTx.postings.length === 0 && periodicTx.line !== undefined) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: getLineRange(periodicTx.line, lines),
            message: 'Periodic transaction has no postings',
            source: 'hledger'
          });
        }
      }
    }

    // Check for undeclared items (each type can be enabled/disabled separately)
    const undeclaredIssues = validateUndeclaredItems(
      lines,
      parsedDoc,
      settings,
      documentUri,
      isEnabled('undeclaredAccounts'),
      isEnabled('undeclaredPayees'),
      isEnabled('undeclaredCommodities'),
      isEnabled('undeclaredTags')
    );
    diagnostics.push(...undeclaredIssues);

    // Check date ordering
    if (isEnabled('dateOrdering')) {
      const dateOrderIssues = validateDateOrdering(parsedDoc.transactions, lines, documentUri);
      diagnostics.push(...dateOrderIssues);
    }

    // Check balance assertions
    if (isEnabled('balanceAssertions')) {
      const assertionIssues = validateBalanceAssertions(parsedDoc.transactions, lines, parsedDoc, documentUri, document);
      diagnostics.push(...assertionIssues);
    }

    // Check include directives
    if (options?.fileReader && (isEnabled('includeFiles') || isEnabled('circularIncludes'))) {
      const includeIssues = validateIncludeDirectives(document, parsedDoc, options, isEnabled('includeFiles'), isEnabled('circularIncludes'), lines);
      diagnostics.push(...includeIssues);
    }

    return { diagnostics };
  }
}

export const validator = new Validator();
