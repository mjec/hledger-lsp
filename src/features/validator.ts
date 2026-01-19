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
import { ParsedDocument, Transaction, Posting, FileReader } from '../types';
import { resolveIncludePath, resolveIncludePaths } from '../utils/uri';
import { ValidationOptions, SeverityOptions, defaultSettings, FormattingOptions } from '../server/settings';
import { calculateTransactionBalance } from '../utils/balanceCalculator';
import { formatAmount } from '../utils/amountFormatter';
import { getFormatUnsafeReason } from './formattingValidation';
import { getEffectiveDate } from '../utils/index';

export interface ValidationResult {
  diagnostics: Diagnostic[];
}

/**
 * Options for validator
 */
export interface ValidatorOptions {
  /**
   * Base URI for resolving include paths
   */
  baseUri?: URI;

  /**
   * Function to check if files exist
   */
  fileReader?: FileReader;

  /**
   * Validation settings from user configuration
   */
  settings?: {
    validation?: Partial<ValidationOptions>;
    severity?: Partial<SeverityOptions>;
  };
}

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
        const balanceIssues = this.validateBalance(transaction, document, parsedDoc);
        diagnostics.push(...balanceIssues);
      }

      // Check missing amounts
      if (isEnabled('missingAmounts')) {
        const amountIssues = this.validateMissingAmounts(transaction, document);
        diagnostics.push(...amountIssues);
      }

      // Check empty transactions
      if (isEnabled('emptyTransactions')) {
        const emptyTxnIssues = this.validateEmptyTransaction(transaction, document);
        diagnostics.push(...emptyTxnIssues);
      }

      // Check invalid date formats
      if (isEnabled('invalidDates')) {
        const invalidDateIssues = this.validateDateFormat(transaction, document);
        diagnostics.push(...invalidDateIssues);
      }

      // Check future dates
      if (isEnabled('futureDates')) {
        const futureDateIssues = this.validateFutureDate(transaction, document);
        diagnostics.push(...futureDateIssues);
      }

      // Check empty descriptions
      if (isEnabled('emptyDescriptions')) {
        const emptyDescIssues = this.validateEmptyDescription(transaction, document);
        diagnostics.push(...emptyDescIssues);
      }

      // Check format mismatches
      if (isEnabled('formatMismatch')) {
        const formatIssues = this.validateFormatMismatch(transaction, document, parsedDoc, settings);
        diagnostics.push(...formatIssues);
      }
    }

    // Check for undeclared items (each type can be enabled/disabled separately)
    const undeclaredIssues = this.validateUndeclaredItems(
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
      const dateOrderIssues = this.validateDateOrdering(parsedDoc.transactions, document);
      diagnostics.push(...dateOrderIssues);
    }

    // Check balance assertions
    if (isEnabled('balanceAssertions')) {
      const assertionIssues = this.validateBalanceAssertions(parsedDoc.transactions, document, parsedDoc);
      diagnostics.push(...assertionIssues);
    }

    // Check include directives
    if (options?.fileReader && (isEnabled('includeFiles') || isEnabled('circularIncludes'))) {
      const includeIssues = this.validateIncludeDirectives(document, parsedDoc, options, isEnabled('includeFiles'), isEnabled('circularIncludes'));
      diagnostics.push(...includeIssues);
    }

    return { diagnostics };
  }

  /**
   * Validate transaction balance
   * Transactions must balance (all amounts sum to zero per commodity)
   */
  private validateBalance(transaction: Transaction, document: TextDocument, parsedDoc: ParsedDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Calculate transaction balance by commodity
    const balances = calculateTransactionBalance(transaction);

    // Count how many postings have explicit (non-inferred) amounts
    let postingsWithExplicitAmounts = 0;
    for (const posting of transaction.postings) {
      if (posting.amount && !posting.amount.inferred) {
        postingsWithExplicitAmounts++;
      }
    }

    // If all postings have explicit amounts, check if they balance
    // (skip checking for transactions with inferred amounts)
    if (postingsWithExplicitAmounts === transaction.postings.length) {
      for (const [commodity, balance] of balances.entries()) {
        // Allow for small floating point errors
        if (Math.abs(balance) > 0.005) {
          const formattedBalance = commodity
            ? formatAmount(balance, commodity, parsedDoc)
            : balance.toFixed(2);
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: this.getTransactionRange(transaction, document),
            message: `Transaction does not balance: ${formattedBalance} off`,
            source: 'hledger'
          });
        }
      }
    }

    return diagnostics;
  }

  /**
   * Validate missing amounts in transaction
   * At most one posting can omit an amount
   */
  private validateMissingAmounts(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const postingsWithoutAmounts = transaction.postings.filter(p => !p.amount);

    if (postingsWithoutAmounts.length > 1) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: this.getTransactionRange(transaction, document),
        message: `Transaction has ${postingsWithoutAmounts.length} postings without amounts (maximum 1 allowed)`,
        source: 'hledger'
      });
    }

    return diagnostics;
  }

  /**
   * Validate undeclared items
   * Warn when accounts, payees, commodities, or tags are used but not declared
   */
  private validateUndeclaredItems(
    document: TextDocument,
    parsedDoc: ParsedDocument,
    settings: { validation?: Partial<ValidationOptions>; severity?: Partial<SeverityOptions> } | undefined,
    checkAccounts: boolean = true,
    checkPayees: boolean = true,
    checkCommodities: boolean = true,
    checkTags: boolean = true
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

    // Helper to convert severity string to DiagnosticSeverity
    const getSeverity = (severityStr?: string): DiagnosticSeverity => {
      switch (severityStr) {
        case 'error': return DiagnosticSeverity.Error;
        case 'warning': return DiagnosticSeverity.Warning;
        case 'information': return DiagnosticSeverity.Information;
        case 'hint': return DiagnosticSeverity.Hint;
        default: return DiagnosticSeverity.Warning; // default
      }
    };

    // Check if we should mark all instances or just the first one
    const markAllInstances = settings?.validation?.markAllUndeclaredInstances ?? defaultSettings.validation.markAllUndeclaredInstances;

    // Check undeclared accounts (if enabled)
    if (checkAccounts) {
      const undeclaredAccounts = new Set(
        Array.from(parsedDoc.accounts.values()).filter(a => !a.declared).map(a => a.name)
      );

      if (undeclaredAccounts.size > 0) {
        const text = document.getText();
        const lines = text.split('\n');
        const processedAccounts = new Set<string>();

        // Iterate through transactions to find account usage locations
        for (const transaction of parsedDoc.transactions) {
          // Only process transactions from the current document
          if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
            continue;
          }

          if (transaction.line !== undefined) {
            let postingLineOffset = 1;
            for (const posting of transaction.postings) {
              const accountName = posting.account;
              if (undeclaredAccounts.has(accountName)) {
                if (!markAllInstances && processedAccounts.has(accountName)) {
                  postingLineOffset++;
                  continue;
                }

                // Find the posting line
                const postingLine = transaction.line + postingLineOffset;
                if (postingLine < lines.length) {
                  const line = lines[postingLine];
                  // Account name is after indentation, before amount/comment
                  const accountIndex = line.indexOf(accountName);
                  if (accountIndex !== -1) {
                    diagnostics.push({
                      severity: getSeverity(settings?.severity?.undeclaredAccounts),
                      range: {
                        start: { line: postingLine, character: accountIndex },
                        end: { line: postingLine, character: accountIndex + accountName.length }
                      },
                      message: `Account "${accountName}" is used but not declared with 'account' directive`,
                      source: 'hledger',
                      code: 'undeclared-account',
                      data: { accountName }
                    });
                    processedAccounts.add(accountName);
                  }
                }
              }
              postingLineOffset++;
            }
          }
        }
      }
    }

    // Check undeclared payees (if enabled)
    if (checkPayees) {
      const undeclaredPayees = new Set(
        Array.from(parsedDoc.payees.values()).filter(p => !p.declared).map(p => p.name)
      );

      if (undeclaredPayees.size > 0) {
        const text = document.getText();
        const lines = text.split('\n');
        const processedPayees = new Set<string>();

        // Iterate through transactions to find payee usage locations
        for (const transaction of parsedDoc.transactions) {
          // Only process transactions from the current document
          if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
            continue;
          }

          const payeeName = transaction.payee;
          if (undeclaredPayees.has(payeeName) && transaction.line !== undefined) {
            if (!markAllInstances && processedPayees.has(payeeName)) {
              continue;
            }

            const line = lines[transaction.line];
            // Payee is in the transaction header after date, status, and code
            const payeeIndex = line.indexOf(payeeName);
            if (payeeIndex !== -1) {
              diagnostics.push({
                severity: getSeverity(settings?.severity?.undeclaredPayees),
                range: {
                  start: { line: transaction.line, character: payeeIndex },
                  end: { line: transaction.line, character: payeeIndex + payeeName.length }
                },
                message: `Payee "${payeeName}" is used but not declared with 'payee' directive`,
                source: 'hledger',
                code: 'undeclared-payee',
                data: { payeeName }
              });
              processedPayees.add(payeeName);
            }
          }
        }
      }
    }

    // Check undeclared commodities (if enabled)
    if (checkCommodities) {
      const undeclaredCommodities = new Set(
        Array.from(parsedDoc.commodities.values()).filter(c => !c.declared).map(c => c.name)
      );

      if (undeclaredCommodities.size > 0) {
        const text = document.getText();
        const lines = text.split('\n');
        const processedCommodities = new Set<string>();

        // Iterate through transactions to find commodity usage locations
        for (const transaction of parsedDoc.transactions) {
          // Only process transactions from the current document
          if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
            continue;
          }

          if (transaction.line !== undefined) {
            let postingLineOffset = 1;
            for (const posting of transaction.postings) {
              const postingLine = transaction.line + postingLineOffset;
              if (postingLine < lines.length) {
                const line = lines[postingLine];

                // Check commodity in posting amount
                if (posting.amount?.commodity && undeclaredCommodities.has(posting.amount.commodity)) {
                  const commodityName = posting.amount.commodity;
                  if (!markAllInstances && processedCommodities.has(commodityName)) {
                    postingLineOffset++;
                    continue;
                  }

                  const commodityIndex = line.indexOf(commodityName);
                  if (commodityIndex !== -1) {
                    diagnostics.push({
                      severity: getSeverity(settings?.severity?.undeclaredCommodities),
                      range: {
                        start: { line: postingLine, character: commodityIndex },
                        end: { line: postingLine, character: commodityIndex + commodityName.length }
                      },
                      message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                      source: 'hledger',
                      code: 'undeclared-commodity',
                      data: { commodityName }
                    });
                    processedCommodities.add(commodityName);
                  }
                }

                // Check commodity in cost notation
                if (posting.cost?.amount?.commodity && undeclaredCommodities.has(posting.cost.amount.commodity)) {
                  const commodityName = posting.cost.amount.commodity;
                  if (!markAllInstances && processedCommodities.has(commodityName)) {
                    postingLineOffset++;
                    continue;
                  }

                  // Cost appears after @ or @@
                  const atIndex = line.indexOf('@');
                  if (atIndex !== -1) {
                    const afterAt = line.substring(atIndex);
                    const commodityIndex = afterAt.indexOf(commodityName);
                    if (commodityIndex !== -1) {
                      const absoluteIndex = atIndex + commodityIndex;
                      diagnostics.push({
                        severity: getSeverity(settings?.severity?.undeclaredCommodities),
                        range: {
                          start: { line: postingLine, character: absoluteIndex },
                          end: { line: postingLine, character: absoluteIndex + commodityName.length }
                        },
                        message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                        source: 'hledger',
                        code: 'undeclared-commodity',
                        data: { commodityName }
                      });
                      processedCommodities.add(commodityName);
                    }
                  }
                }

                // Check commodity in balance assertion
                if (posting.assertion?.commodity && undeclaredCommodities.has(posting.assertion.commodity)) {
                  const commodityName = posting.assertion.commodity;
                  if (!markAllInstances && processedCommodities.has(commodityName)) {
                    postingLineOffset++;
                    continue;
                  }

                  // Assertion appears after =
                  const equalsIndex = line.indexOf('=');
                  if (equalsIndex !== -1) {
                    const afterEquals = line.substring(equalsIndex);
                    const commodityIndex = afterEquals.indexOf(commodityName);
                    if (commodityIndex !== -1) {
                      const absoluteIndex = equalsIndex + commodityIndex;
                      diagnostics.push({
                        severity: getSeverity(settings?.severity?.undeclaredCommodities),
                        range: {
                          start: { line: postingLine, character: absoluteIndex },
                          end: { line: postingLine, character: absoluteIndex + commodityName.length }
                        },
                        message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                        source: 'hledger',
                        code: 'undeclared-commodity',
                        data: { commodityName }
                      });
                      processedCommodities.add(commodityName);
                    }
                  }
                }
              }
              postingLineOffset++;
            }
          }
        }
      }
    }

    // Check undeclared tags (if enabled)
    if (checkTags) {
      const undeclaredTags = new Set(
        Array.from(parsedDoc.tags.values()).filter(t => !t.declared).map(t => t.name)
      );

      if (undeclaredTags.size > 0) {
        const text = document.getText();
        const lines = text.split('\n');
        const processedTags = new Set<string>();

        // Iterate through transactions to find tag usage locations
        for (const transaction of parsedDoc.transactions) {
          // Only process transactions from the current document
          if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
            continue;
          }

          // Check transaction-level tags
          if (transaction.tags) {
            for (const tagName of Object.keys(transaction.tags)) {
              if (undeclaredTags.has(tagName) && transaction.line !== undefined) {
                if (!markAllInstances && processedTags.has(tagName)) {
                  continue; // Skip if we already reported this tag
                }

                const line = lines[transaction.line];
                const commentIndex = line.indexOf(';');
                if (commentIndex !== -1) {
                  const tagIndex = line.indexOf(tagName + ':', commentIndex);
                  if (tagIndex !== -1) {
                    diagnostics.push({
                      severity: getSeverity(settings?.severity?.undeclaredTags || 'information'),
                      range: {
                        start: { line: transaction.line, character: tagIndex },
                        end: { line: transaction.line, character: tagIndex + tagName.length + 1 }
                      },
                      message: `Tag "${tagName}" is used but not declared with 'tag' directive`,
                      source: 'hledger',
                      code: 'undeclared-tag',
                      data: { tagName }
                    });
                    processedTags.add(tagName);
                  }
                }
              }
            }
          }

          // Check posting-level tags
          if (transaction.line !== undefined) {
            let postingLineOffset = 1;
            for (const posting of transaction.postings) {
              if (posting.tags) {
                for (const tagName of Object.keys(posting.tags)) {
                  if (undeclaredTags.has(tagName)) {
                    if (!markAllInstances && processedTags.has(tagName)) {
                      continue;
                    }

                    // Find the posting line
                    const postingLine = transaction.line + postingLineOffset;
                    if (postingLine < lines.length) {
                      const line = lines[postingLine];
                      const commentIndex = line.indexOf(';');
                      if (commentIndex !== -1) {
                        const tagIndex = line.indexOf(tagName + ':', commentIndex);
                        if (tagIndex !== -1) {
                          diagnostics.push({
                            severity: getSeverity(settings?.severity?.undeclaredTags || 'information'),
                            range: {
                              start: { line: postingLine, character: tagIndex },
                              end: { line: postingLine, character: tagIndex + tagName.length + 1 }
                            },
                            message: `Tag "${tagName}" is used but not declared with 'tag' directive`,
                            source: 'hledger',
                            code: 'undeclared-tag',
                            data: { tagName }
                          });
                          processedTags.add(tagName);
                        }
                      }
                    }
                  }
                }
              }
              postingLineOffset++;
            }
          }
        }
      }
    }

    return diagnostics;
  }

  /**
   * Get the range for a transaction (first line only for now)
   */
  private getTransactionRange(transaction: Transaction, document: TextDocument): { start: { line: number; character: number }; end: { line: number; character: number } } {
    const text = document.getText();
    const lines = text.split('\n');

    // Find the transaction in the document
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(transaction.date) && line.includes(transaction.description)) {
        return {
          start: { line: i, character: 0 },
          end: { line: i, character: line.length }
        };
      }
    }

    // Fallback to first line if not found
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 }
    };
  }

  /**
   * Find the first occurrence of a string in the document
   */
  private findFirstOccurrence(document: TextDocument, searchStr: string): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const index = line.indexOf(searchStr);
      if (index !== -1) {
        return {
          start: { line: i, character: index },
          end: { line: i, character: index + searchStr.length }
        };
      }
    }

    return null;
  }

  /**
   * Validate date ordering
   * Warn if transactions are not in chronological order
   */
  private validateDateOrdering(transactions: Transaction[], document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

    // Only validate transactions in the current document
    const documentTransactions = transactions.filter(t => t.sourceUri?.toString() === documentUri);

    for (let i = 1; i < documentTransactions.length; i++) {
      const prevDate = this.parseDate(documentTransactions[i - 1].date);
      const currDate = this.parseDate(documentTransactions[i].date);

      if (prevDate && currDate && currDate < prevDate) {
        const range = this.getTransactionRange(documentTransactions[i], document);
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `Transaction date ${documentTransactions[i].date} is before previous transaction date ${documentTransactions[i - 1].date}`,
          source: 'hledger'
        });
      }
    }

    return diagnostics;
  }

  /**
   * Validate balance assertions
   * Check if balance assertions match calculated balances
   * Respects posting dates for chronological ordering
   * For same-day transactions across files, orders by include position
   */
  private validateBalanceAssertions(
    transactions: Transaction[],
    document: TextDocument,
    parsedDoc: ParsedDocument
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();
    const baseUri = URI.parse(document.uri);

    // Build a map from included file URI to the include directive's line number
    // This determines the ordering position for transactions from included files
    const includePositionMap = new Map<string, number>();
    for (const directive of parsedDoc.directives) {
      if (directive.type === 'include' && directive.line !== undefined) {
        // Resolve the include path to get the actual file URI
        const resolvedUri = resolveIncludePath(directive.value, baseUri);
        includePositionMap.set(resolvedUri.toString(), directive.line);
      }
    }

    // Extract all postings with effective dates and ordering info
    interface PostingWithContext {
      transaction: Transaction;
      posting: Posting;
      effectiveDate: string;
      orderPosition: number;  // Line number for ordering (include line or transaction line)
      lineInFile: number;     // Line within source file for secondary ordering
    }

    const allPostings: PostingWithContext[] = [];

    for (const transaction of transactions) {
      // Determine the order position for this transaction
      let orderPosition: number;
      const txnSourceUri = transaction.sourceUri?.toString() || '';

      if (txnSourceUri === documentUri) {
        // Transaction is in the root file - use its own line number
        orderPosition = transaction.line ?? 0;
      } else {
        // Transaction is from an included file - use the include directive's line
        orderPosition = includePositionMap.get(txnSourceUri) ?? 0;
      }

      const lineInFile = transaction.line ?? 0;

      for (const posting of transaction.postings) {
        allPostings.push({
          transaction,
          posting,
          effectiveDate: getEffectiveDate(posting, transaction),
          orderPosition,
          lineInFile
        });
      }
    }

    // Sort by: 1) effective date, 2) order position, 3) line within file
    allPostings.sort((a, b) => {
      // Primary: sort by date
      const dateCompare = a.effectiveDate.localeCompare(b.effectiveDate);
      if (dateCompare !== 0) return dateCompare;

      // Secondary: sort by order position (include line or transaction line in root)
      const positionCompare = a.orderPosition - b.orderPosition;
      if (positionCompare !== 0) return positionCompare;

      // Tertiary: sort by line within source file (for multiple transactions in same included file)
      return a.lineInFile - b.lineInFile;
    });

    // Track running balances
    const runningBalances = new Map<string, Map<string, number>>();

    for (const { transaction, posting } of allPostings) {
      const account = posting.account;

      // Update balance if posting has amount
      if (posting.amount) {
        if (!runningBalances.has(account)) {
          runningBalances.set(account, new Map());
        }
        const commodityBalances = runningBalances.get(account)!;
        const commodity = posting.amount.commodity || '';
        const currentBalance = commodityBalances.get(commodity) || 0;
        const newBalance = currentBalance + posting.amount.quantity;
        commodityBalances.set(commodity, newBalance);
      }

      // Check assertion (only for current document)
      if (posting.assertion && transaction.sourceUri?.toString() === documentUri) {
        const assertedCommodity = posting.assertion.commodity || '';
        const assertedAmount = posting.assertion.quantity;
        const actualBalance = runningBalances.get(account)?.get(assertedCommodity) || 0;

        // Allow for small floating point errors
        if (Math.abs(actualBalance - assertedAmount) > 0.005) {
          const range = this.findPostingRange(transaction, posting, document);
          const expectedFormatted = formatAmount(assertedAmount, assertedCommodity, parsedDoc);
          const actualFormatted = formatAmount(actualBalance, assertedCommodity, parsedDoc);

          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `Balance assertion failed for ${account}: expected ${expectedFormatted}, but calculated ${actualFormatted}`,
            source: 'hledger'
          });
        }
      }
    }

    return diagnostics;
  }

  /**
   * Parse a date string to a Date object
   */
  private parseDate(dateStr: string): Date | null {
    // Handle both YYYY-MM-DD and YYYY/MM/DD formats
    const normalized = dateStr.replace(/\//g, '-');
    const date = new Date(normalized);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Find the range for a specific posting within a transaction
   */
  private findPostingRange(transaction: Transaction, posting: Posting, document: TextDocument): { start: { line: number; character: number }; end: { line: number; character: number } } {
    const text = document.getText();
    const lines = text.split('\n');

    // Find the transaction, then find the posting
    let inTransaction = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this is our transaction
      if (line.includes(transaction.date) && line.includes(transaction.description)) {
        inTransaction = true;
        continue;
      }

      // If we're in the transaction, look for the posting
      if (inTransaction && line.trim().startsWith(posting.account)) {
        return {
          start: { line: i, character: 0 },
          end: { line: i, character: line.length }
        };
      }

      // Stop if we hit another transaction or empty line after being in a transaction
      if (inTransaction && (!line.trim() || line.match(/^\d{4}[-/]\d{2}[-/]\d{2}/))) {
        break;
      }
    }

    // Fallback to transaction range
    return this.getTransactionRange(transaction, document);
  }

  /**
   * Validate empty transactions
   * Transactions must have at least 2 postings
   */
  private validateEmptyTransaction(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (transaction.postings.length < 2) {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Transaction has only ${transaction.postings.length} posting(s), minimum 2 required`,
        source: 'hledger'
      });
    }

    return diagnostics;
  }

  /**
   * Validate date format
   * Check for invalid dates like 2024-13-01 or 2024-02-30
   */
  private validateDateFormat(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const normalized = transaction.date.replace(/\//g, '-');
    const parts = normalized.split('-');

    if (parts.length !== 3) {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Invalid date format: ${transaction.date}`,
        source: 'hledger'
      });
      return diagnostics;
    }

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    // Check if values are in valid ranges
    if (month < 1 || month > 12) {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Invalid month in date: ${transaction.date} (month must be 1-12)`,
        source: 'hledger'
      });
      return diagnostics;
    }

    if (day < 1 || day > 31) {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Invalid day in date: ${transaction.date} (day must be 1-31)`,
        source: 'hledger'
      });
      return diagnostics;
    }

    // Now try to parse the date
    const parsedDate = this.parseDate(transaction.date);

    if (!parsedDate) {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Invalid date format: ${transaction.date}`,
        source: 'hledger'
      });
      return diagnostics;
    }

    // Check if the date components match the parsed date
    // This catches cases like Feb 30 which get corrected to Mar 2
    // Use UTC getters to match the UTC parsing of "YYYY-MM-DD" format
    // This ensures correct validation regardless of timezone
    if (parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() + 1 !== month ||
      parsedDate.getUTCDate() !== day) {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Invalid date: ${transaction.date} (date does not exist in calendar)`,
        source: 'hledger'
      });
    }

    return diagnostics;
  }

  /**
   * Validate future dates
   * Warn about transactions dated in the future
   */
  private validateFutureDate(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const parsedDate = this.parseDate(transaction.date);
    if (!parsedDate) {
      return diagnostics; // Already handled by validateDateFormat
    }

    // Use UTC for consistent date comparison regardless of timezone
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); // Reset time portion for date-only comparison

    if (parsedDate > today) {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Transaction date ${transaction.date} is in the future`,
        source: 'hledger'
      });
    }

    return diagnostics;
  }

  /**
   * Validate empty descriptions
   * Warn about transactions with no description/payee
   */
  private validateEmptyDescription(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (!transaction.description || transaction.description.trim() === '') {
      const range = this.getTransactionRange(transaction, document);
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: 'Transaction has no description',
        source: 'hledger'
      });
    }

    return diagnostics;
  }

  /**
   * Validate include directives
   * Check for missing files and circular includes
   */
  private validateIncludeDirectives(
    document: TextDocument,
    parsedDoc: ParsedDocument,
    options: ValidatorOptions,
    checkMissingFiles: boolean = true,
    checkCircularIncludes: boolean = true
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const visited = new Set<string>();
    const baseUri = options.baseUri || URI.parse(document.uri);
    const fileReader = options.fileReader!;
    const documentUri = URI.parse(document.uri);

    // Find all include directives in the document
    const includeDirectives = parsedDoc.directives.filter(d => d.type === 'include');

    for (const directive of includeDirectives) {
      const includePath = directive.value;

      // Check if this is a glob pattern
      const isGlob = /[*?\[\]{}]/.test(includePath);

      if (isGlob) {
        // For glob patterns, expand to all matching files
        const resolvedPaths = resolveIncludePaths(includePath, baseUri);

        // Check if glob matched any files (if enabled)
        if (resolvedPaths.length === 0 && checkMissingFiles) {
          const range = this.findFirstOccurrence(document, includePath);
          if (range) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range,
              message: `Include glob pattern matches no files: ${includePath}`,
              source: 'hledger'
            });
          }
        }

        // Check for circular includes for each matched file
        if (checkCircularIncludes) {
          for (const resolvedPath of resolvedPaths) {
            const includeDoc = fileReader(resolvedPath);
            if (includeDoc) {
              const circularCheck = this.checkCircularInclude(documentUri, includeDoc, fileReader, new Set([baseUri.toString(), resolvedPath.toString()]));
              if (circularCheck) {
                const range = this.findFirstOccurrence(document, includePath);
                if (range) {
                  diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range,
                    message: `Circular include detected in glob: ${includePath} (via ${resolvedPath})`,
                    source: 'hledger'
                  });
                  break; // Only report once per glob pattern
                }
              }
            }
          }
        }
      } else {
        // Single file include (existing logic)
        const resolvedPath = resolveIncludePath(includePath, baseUri);

        // Check for duplicate includes in the same document
        if (visited.has(resolvedPath.toString())) {
          const range = this.findFirstOccurrence(document, includePath);
          if (range) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range,
              message: `Duplicate include: ${includePath}`,
              source: 'hledger'
            });
          }
          continue;
        }

        visited.add(resolvedPath.toString());

        // Check if file exists (if enabled)
        const includeDoc = fileReader(resolvedPath);

        if (!includeDoc && checkMissingFiles) {
          // File doesn't exist
          const range = this.findFirstOccurrence(document, includePath);
          if (range) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range,
              message: `Include file not found: ${includePath}`,
              source: 'hledger'
            });
          }
        }

        // Check for circular includes (if enabled and file exists)
        if (includeDoc && checkCircularIncludes) {
          const circularCheck = this.checkCircularInclude(documentUri, includeDoc, fileReader, new Set([baseUri.toString(), resolvedPath.toString()]));
          if (circularCheck) {
            const range = this.findFirstOccurrence(document, includePath);
            if (range) {
              diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range,
                message: `Circular include detected: ${includePath}`,
                source: 'hledger'
              });
            }
          }
        }
      }
    }

    return diagnostics;
  }

  /**
   * Validate format mismatches
   * Check if amounts have format issues that would cause data corruption during formatting
   */
  private validateFormatMismatch(
    transaction: Transaction,
    document: TextDocument,
    parsedDoc: ParsedDocument,
    settings?: { validation?: Partial<ValidationOptions>; severity?: Partial<SeverityOptions>; formatting?: Partial<FormattingOptions> }
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (transaction.line === undefined) {
      return diagnostics; // Can't create diagnostics without line numbers
    }

    const text = document.getText();
    const lines = text.split('\n');

    // Check each posting's amount for format mismatches
    let postingLineOffset = 1;
    for (const posting of transaction.postings) {
      // Skip inferred amounts - they're safe by design
      if (posting.amount?.inferred) {
        postingLineOffset++;
        continue;
      }

      // Skip postings without amounts
      if (!posting.amount) {
        postingLineOffset++;
        continue;
      }

      // Get formatting settings (fall back to defaults)
      const formattingSettings = settings?.formatting ? settings.formatting : defaultSettings.formatting;

      // Check if this amount has format issues
      const unsafeReason = getFormatUnsafeReason(posting.amount, parsedDoc, formattingSettings);

      if (unsafeReason) {
        const postingLine = transaction.line + postingLineOffset;
        if (postingLine < lines.length) {
          const line = lines[postingLine];

          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: postingLine, character: 0 },
              end: { line: postingLine, character: line.length }
            },
            message: unsafeReason.message,
            source: 'hledger-formatter',
            code: unsafeReason.code
          });
        }
      }

      postingLineOffset++;
    }

    return diagnostics;
  }

  /**
   * Check if a circular include exists by recursively following includes
   */
  private checkCircularInclude(targetUri: URI, document: TextDocument, fileReader: FileReader, visited: Set<string>): boolean {
    const text = document.getText();
    const documentUri = URI.parse(document.uri);
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('include ')) {
        const includePath = trimmedLine.substring(8).trim();
        const resolvedPath = resolveIncludePath(includePath, documentUri);

        // Check if this include points back to the target
        if (resolvedPath.toString() === targetUri.toString()) {
          return true;
        }

        // Avoid infinite recursion
        if (visited.has(resolvedPath.toString())) {
          continue;
        }

        visited.add(resolvedPath.toString());

        // Recursively check this file
        const includeDoc = fileReader(resolvedPath);
        if (includeDoc) {
          if (this.checkCircularInclude(targetUri, includeDoc, fileReader, visited)) {
            return true;
          }
        }
      }
    }

    return false;
  }

}

export const validator = new Validator();
