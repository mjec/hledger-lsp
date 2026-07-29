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
import { logger } from '../utils/logger';

const validatorLog = logger.withContext('Validator');
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
  resolveBalanceAssignments,
  validateBalanceAssignmentRules,
  validateIncludeDirectives,
  validateFormatMismatch,
  validateUndeclaredItems,
  validateCommodityDirectives
} from './validation/index';

export { ValidationResult, ValidatorOptions };

export class Validator {
  /**
   * Validate a parsed hledger document
   */
  validate(document: TextDocument, parsedDoc: ParsedDocument, options?: ValidatorOptions, reason?: string): ValidationResult {
    const diagnostics: Diagnostic[] = [];
    const settings = options?.settings;

    // Split document text once for all validation functions
    const lines = document.getText().split('\n');

    // Normalize document URI to ensure proper encoding (e.g., @ -> %40)
    // This fixes issues where clients (like Neovim) send partially-encoded URIs
    const documentUri = URI.parse(document.uri).toString();

    validatorLog.debug(
      `validating ${documentUri}${reason ? ` [${reason}]` : ''} — ` +
      `${parsedDoc.transactions.length} transactions, ` +
      `${parsedDoc.periodicTransactions.length} periodic`
    );

    // Infer amounts for balance assignments before any check runs. This is not
    // gated on a setting: individual validations can be disabled, but every
    // check that reads posting amounts needs the inferred ones.
    try {
      resolveBalanceAssignments(parsedDoc, documentUri, URI.parse(document.uri));
    } catch (e) {
      validatorLog.error('balance assignment inference failed', e);
    }

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
        try {
          diagnostics.push(...validateNonPeriodicBalance(transaction, lines, parsedDoc));
        } catch (e) {
          validatorLog.error(`balance check failed on line ${transaction.line}`, e);
        }
      }

      // Check for implicit cost inference (strict "balanced" mode)
      if (isEnabled('requireExplicitCosts')) {
        try {
          diagnostics.push(...validateExplicitCosts(transaction, lines));
        } catch (e) {
          validatorLog.error(`explicit cost check failed on line ${transaction.line}`, e);
        }
      }

      // Check uses of balance assignments that hledger rejects
      if (isEnabled('balanceAssertions')) {
        try {
          diagnostics.push(...validateBalanceAssignmentRules(transaction, lines));
        } catch (e) {
          validatorLog.error(`balance assignment rule check failed on line ${transaction.line}`, e);
        }
      }

      // Check missing amounts
      if (isEnabled('missingAmounts')) {
        try {
          diagnostics.push(...validateMissingAmounts(transaction, lines));
        } catch (e) {
          validatorLog.error(`missing amounts check failed on line ${transaction.line}`, e);
        }
      }

      // Check empty transactions
      if (isEnabled('emptyTransactions')) {
        try {
          diagnostics.push(...validateEmptyTransaction(transaction, lines));
        } catch (e) {
          validatorLog.error(`empty transaction check failed on line ${transaction.line}`, e);
        }
      }

      // Check invalid date formats
      if (isEnabled('invalidDates')) {
        try {
          diagnostics.push(...validateDateFormat(transaction, lines));
        } catch (e) {
          validatorLog.error(`date format check failed on line ${transaction.line}`, e);
        }
      }

      // Check future dates
      if (isEnabled('futureDates')) {
        try {
          diagnostics.push(...validateFutureDate(transaction, lines));
        } catch (e) {
          validatorLog.error(`future date check failed on line ${transaction.line}`, e);
        }
      }

      // Check empty descriptions
      if (isEnabled('emptyDescriptions')) {
        try {
          diagnostics.push(...validateEmptyDescription(transaction, lines));
        } catch (e) {
          validatorLog.error(`empty description check failed on line ${transaction.line}`, e);
        }
      }

      // Check format mismatches
      if (isEnabled('formatMismatch')) {
        try {
          diagnostics.push(...validateFormatMismatch(transaction, lines, parsedDoc, settings));
        } catch (e) {
          validatorLog.error(`format mismatch check failed on line ${transaction.line}`, e);
        }
      }
    }

    // Validate periodic transactions
    for (const periodicTx of parsedDoc.periodicTransactions) {
      if (!isFromDocument(periodicTx, documentUri)) {
        continue;
      }

      // Check balance (periodic transactions must balance like regular ones)
      if (isEnabled('balance')) {
        try {
          diagnostics.push(...validatePeriodicTransactionBalance(periodicTx, lines, parsedDoc));
        } catch (e) {
          validatorLog.error(`periodic balance check failed on line ${periodicTx.line}`, e);
        }
      }

      // Check missing amounts
      if (isEnabled('missingAmounts')) {
        try {
          diagnostics.push(...validatePeriodicTransactionMissingAmounts(periodicTx, lines));
        } catch (e) {
          validatorLog.error(`periodic missing amounts check failed on line ${periodicTx.line}`, e);
        }
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

    // Check commodity directive syntax
    if (isEnabled('commodityDirectives')) {
      try {
        diagnostics.push(...validateCommodityDirectives(lines));
      } catch (e) {
        validatorLog.error('commodity directive check failed', e);
      }
    }

    // Check for undeclared items (each type can be enabled/disabled separately)
    try {
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
    } catch (e) {
      validatorLog.error('undeclared items check failed', e);
    }

    // Check date ordering
    if (isEnabled('dateOrdering')) {
      try {
        diagnostics.push(...validateDateOrdering(parsedDoc.transactions, lines, documentUri));
      } catch (e) {
        validatorLog.error('date ordering check failed', e);
      }
    }

    // Check balance assertions
    if (isEnabled('balanceAssertions')) {
      try {
        diagnostics.push(...validateBalanceAssertions(parsedDoc.transactions, lines, parsedDoc, documentUri, document));
      } catch (e) {
        validatorLog.error('balance assertions check failed', e);
      }
    }

    // Check include directives
    if (options?.fileReader && (isEnabled('includeFiles') || isEnabled('circularIncludes'))) {
      try {
        diagnostics.push(...validateIncludeDirectives(document, parsedDoc, options, isEnabled('includeFiles'), isEnabled('circularIncludes'), lines));
      } catch (e) {
        validatorLog.error('include directives check failed', e);
      }
    }

    validatorLog.debug(`${documentUri}: ${diagnostics.length} diagnostic(s) produced`);

    return { diagnostics };
  }
}

export const validator = new Validator();
