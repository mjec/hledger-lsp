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
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Transaction, Posting } from '../types';
import { FileReader } from '../parser/index';
import { resolveIncludePath } from '../utils/uri';
import { defaultSettings } from '../server/settings';

export interface ValidationResult {
  diagnostics: Diagnostic[];
}

/**
 * Validation settings
 */
export interface ValidationSettings {
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
}

/**
 * Options for validation
 */
export interface ValidationOptions {
  /**
   * Base URI for resolving include paths
   */
  baseUri?: string;

  /**
   * Function to check if files exist
   */
  fileReader?: FileReader;

  /**
   * Validation settings from user configuration
   */
  settings?: ValidationSettings;
}

export class Validator {
  /**
   * Validate a parsed hledger document
   */
  validate(document: TextDocument, parsedDoc: ParsedDocument, options?: ValidationOptions): ValidationResult {
    const diagnostics: Diagnostic[] = [];
    const settings = options?.settings;

    // Helper to check if validation is enabled
    // Uses provided settings, or falls back to default settings
    const isEnabled = (key: keyof NonNullable<ValidationSettings['validation']>): boolean => {
      // If settings are provided, use them
      if (settings?.validation?.[key] !== undefined) {
        return settings.validation[key] === true;
      }
      // Otherwise use defaults
      return defaultSettings.validation?.[key] ?? true;
    };

    // Validate each transaction
    for (const transaction of parsedDoc.transactions) {
      // Check balance
      if (isEnabled('balance')) {
        const balanceIssues = this.validateBalance(transaction, document);
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
  private validateBalance(transaction: Transaction, document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Group postings by commodity
    const balances = new Map<string, number>();

    // Count how many postings have amounts
    let postingsWithAmounts = 0;

    for (const posting of transaction.postings) {
      if (posting.amount) {
        postingsWithAmounts++;

        // If posting has a cost, use the cost commodity for balance calculation
        if (posting.cost) {
          const costCommodity = posting.cost.amount.commodity || '';
          let costValue: number;

          if (posting.cost.type === 'unit') {
            // @ unitPrice: total cost = quantity * unitPrice
            costValue = posting.amount.quantity * posting.cost.amount.quantity;
          } else {
            // @@ totalPrice: use total price directly
            costValue = posting.cost.amount.quantity;
          }

          const current = balances.get(costCommodity) || 0;
          balances.set(costCommodity, current + costValue);
        } else {
          // No cost notation, use the posting's commodity
          const commodity = posting.amount.commodity || '';
          const current = balances.get(commodity) || 0;
          balances.set(commodity, current + posting.amount.quantity);
        }
      }
    }

    // If all postings have amounts, check if they balance
    if (postingsWithAmounts === transaction.postings.length) {
      for (const [commodity, balance] of balances.entries()) {
        // Allow for small floating point errors
        if (Math.abs(balance) > 0.005) {
          const commodityStr = commodity ? ` ${commodity}` : '';
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: this.getTransactionRange(transaction, document),
            message: `Transaction does not balance: ${balance.toFixed(2)}${commodityStr} off`,
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
    settings: ValidationSettings | undefined,
    checkAccounts: boolean = true,
    checkPayees: boolean = true,
    checkCommodities: boolean = true,
    checkTags: boolean = true
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

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
    const markAllInstances = settings?.validation?.markAllUndeclaredInstances ?? defaultSettings.validation?.markAllUndeclaredInstances ?? true;

    // Check undeclared accounts (if enabled)
    if (checkAccounts) {
      const undeclaredAccounts = parsedDoc.accounts.filter(a => !a.declared);
      for (const account of undeclaredAccounts) {
        const ranges = markAllInstances
          ? this.findAllOccurrences(document, account.name)
          : (() => { const r = this.findFirstOccurrence(document, account.name); return r ? [r] : []; })();

        for (const range of ranges) {
          diagnostics.push({
            severity: getSeverity(settings?.severity?.undeclaredAccounts),
            range,
            message: `Account "${account.name}" is used but not declared with 'account' directive`,
            source: 'hledger',
            code: 'undeclared-account',
            data: { accountName: account.name }
          });
        }
      }
    }

    // Check undeclared payees (if enabled)
    if (checkPayees) {
      const undeclaredPayees = parsedDoc.payees.filter(p => !p.declared);
      for (const payee of undeclaredPayees) {
        const ranges = markAllInstances
          ? this.findAllOccurrences(document, payee.name)
          : (() => { const r = this.findFirstOccurrence(document, payee.name); return r ? [r] : []; })();

        for (const range of ranges) {
          diagnostics.push({
            severity: getSeverity(settings?.severity?.undeclaredPayees),
            range,
            message: `Payee "${payee.name}" is used but not declared with 'payee' directive`,
            source: 'hledger',
            code: 'undeclared-payee',
            data: { payeeName: payee.name }
          });
        }
      }
    }

    // Check undeclared commodities (if enabled)
    if (checkCommodities) {
      const undeclaredCommodities = parsedDoc.commodities.filter(c => !c.declared);
      for (const commodity of undeclaredCommodities) {
        const ranges = markAllInstances
          ? this.findAllOccurrences(document, commodity.name)
          : (() => { const r = this.findFirstOccurrence(document, commodity.name); return r ? [r] : []; })();

        for (const range of ranges) {
          diagnostics.push({
            severity: getSeverity(settings?.severity?.undeclaredCommodities),
            range,
            message: `Commodity "${commodity.name}" is used but not declared with 'commodity' directive`,
            source: 'hledger',
            code: 'undeclared-commodity',
            data: { commodityName: commodity.name }
          });
        }
      }
    }

    // Check undeclared tags (if enabled)
    if (checkTags) {
      const undeclaredTags = parsedDoc.tags.filter(t => !t.declared);
      for (const tag of undeclaredTags) {
        const ranges = markAllInstances
          ? this.findAllOccurrences(document, tag.name + ':')
          : (() => { const r = this.findFirstOccurrence(document, tag.name + ':'); return r ? [r] : []; })();

        for (const range of ranges) {
          diagnostics.push({
            severity: getSeverity(settings?.severity?.undeclaredTags || 'information'),
            range,
            message: `Tag "${tag.name}" is used but not declared with 'tag' directive`,
            source: 'hledger',
            code: 'undeclared-tag',
            data: { tagName: tag.name }
          });
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
   * Find all occurrences of a string in the document
   */
  private findAllOccurrences(document: TextDocument, searchStr: string): Array<{ start: { line: number; character: number }; end: { line: number; character: number } }> {
    const text = document.getText();
    const lines = text.split('\n');
    const ranges: Array<{ start: { line: number; character: number }; end: { line: number; character: number } }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let startIndex = 0;
      let index: number;

      // Find all occurrences in this line
      while ((index = line.indexOf(searchStr, startIndex)) !== -1) {
        ranges.push({
          start: { line: i, character: index },
          end: { line: i, character: index + searchStr.length }
        });
        startIndex = index + 1; // Move past this occurrence to find next
      }
    }

    return ranges;
  }

  /**
   * Validate date ordering
   * Warn if transactions are not in chronological order
   */
  private validateDateOrdering(transactions: Transaction[], document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (let i = 1; i < transactions.length; i++) {
      const prevDate = this.parseDate(transactions[i - 1].date);
      const currDate = this.parseDate(transactions[i].date);

      if (prevDate && currDate && currDate < prevDate) {
        const range = this.getTransactionRange(transactions[i], document);
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `Transaction date ${transactions[i].date} is before previous transaction date ${transactions[i - 1].date}`,
          source: 'hledger'
        });
      }
    }

    return diagnostics;
  }

  /**
   * Format an amount with commodity according to declared format
   */
  private formatAmountWithCommodity(
    quantity: number,
    commodityName: string,
    parsedDoc: ParsedDocument
  ): string {
    // Find commodity format
    const commodity = parsedDoc.commodities.find(c => c.name === commodityName);

    if (!commodity?.format) {
      // No format declared, use default: amount then commodity with space
      return commodityName ? `${quantity.toFixed(2)} ${commodityName}` : quantity.toFixed(2);
    }

    const format = commodity.format;
    const symbol = format.symbol || commodityName;
    const symbolOnLeft = format.symbolOnLeft ?? false;
    const spaceBetween = format.spaceBetween ?? true;
    const space = spaceBetween ? ' ' : '';

    // Use precision from format, or default to 2
    const precision = format.precision ?? 2;
    const formattedNumber = quantity.toFixed(precision);

    if (symbolOnLeft) {
      return `${symbol}${space}${formattedNumber}`;
    } else {
      return `${formattedNumber}${space}${symbol}`;
    }
  }

  /**
   * Validate balance assertions
   * Check if balance assertions match calculated balances
   */
  private validateBalanceAssertions(
    transactions: Transaction[],
    document: TextDocument,
    parsedDoc: ParsedDocument
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Track running balances per account per commodity
    const balances = new Map<string, Map<string, number>>();

    for (const transaction of transactions) {
      for (const posting of transaction.postings) {
        // Update running balance
        // Note: Balance assertions check the ORIGINAL commodity (amount.commodity),
        // not the cost commodity. So we always update balance in the amount's commodity.
        if (posting.amount) {
          const accountBalances = balances.get(posting.account) || new Map<string, number>();
          const commodity = posting.amount.commodity || '';
          const currentBalance = accountBalances.get(commodity) || 0;
          // Always use the original amount quantity for balance tracking,
          // regardless of whether there's a cost notation
          accountBalances.set(commodity, currentBalance + posting.amount.quantity);
          balances.set(posting.account, accountBalances);
        }

        // Check assertion
        if (posting.assertion) {
          const accountBalances = balances.get(posting.account);
          const commodity = posting.assertion.commodity || '';
          const expectedBalance = posting.assertion.quantity;
          const actualBalance = accountBalances?.get(commodity) || 0;

          // Allow for small floating point errors
          if (Math.abs(actualBalance - expectedBalance) > 0.005) {
            const range = this.findPostingRange(transaction, posting, document);
            const expectedFormatted = this.formatAmountWithCommodity(expectedBalance, commodity, parsedDoc);
            const actualFormatted = this.formatAmountWithCommodity(actualBalance, commodity, parsedDoc);

            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range,
              message: `Balance assertion failed for ${posting.account}: expected ${expectedFormatted}, but calculated ${actualFormatted}`,
              source: 'hledger'
            });
          }
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
    if (parsedDate.getFullYear() !== year ||
        parsedDate.getMonth() + 1 !== month ||
        parsedDate.getDate() !== day) {
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

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time portion for date-only comparison

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
    options: ValidationOptions,
    checkMissingFiles: boolean = true,
    checkCircularIncludes: boolean = true
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const visited = new Set<string>();
    const baseUri = options.baseUri || document.uri;
    const fileReader = options.fileReader!;

    // Find all include directives in the document
    const includeDirectives = parsedDoc.directives.filter(d => d.type === 'include');

    for (const directive of includeDirectives) {
      const includePath = directive.value;

      // Resolve the include path
      const resolvedPath = resolveIncludePath(includePath, baseUri);

      // Check for duplicate includes in the same document
      if (visited.has(resolvedPath)) {
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

      visited.add(resolvedPath);

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
        const circularCheck = this.checkCircularInclude(document.uri, includeDoc, fileReader, new Set([baseUri, resolvedPath]));
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

    return diagnostics;
  }

  /**
   * Check if a circular include exists by recursively following includes
   */
  private checkCircularInclude(targetUri: string, document: TextDocument, fileReader: FileReader, visited: Set<string>): boolean {
    const text = document.getText();
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('include ')) {
        const includePath = trimmedLine.substring(8).trim();
        const resolvedPath = resolveIncludePath(includePath, document.uri);

        // Check if this include points back to the target
        if (resolvedPath === targetUri) {
          return true;
        }

        // Avoid infinite recursion
        if (visited.has(resolvedPath)) {
          continue;
        }

        visited.add(resolvedPath);

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
