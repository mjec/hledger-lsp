import { URI } from 'vscode-uri';
import { Transaction, Posting, Amount, Account, Payee, Commodity, Tag, Directive, DecimalMark, ThousandsSeparator, Format } from '../types';
import { isPosting, extractAccountFromPosting, extractTags, isTransactionHeader, isComment, stripQuotes } from '../utils/index';

/**
 * Parse a transaction starting at startLine within lines array.
 * This is a pure helper extracted from HledgerParser.
 */
export function parseTransaction(lines: string[], startLine: number, commodities?: Map<string, Commodity>): Transaction | null {
  if (!lines || lines.length === 0) {
    return null;
  }

  const headerLine = lines[0];
  if (!isTransactionHeader(headerLine)) return null;
  const header = parseTransactionHeader(headerLine);
  if (!header) return null;

  const postings: Posting[] = [];
  let currentLine = 1;
  let transactionComment: string | undefined;
  const transactionTags: Record<string, string> = {};

  while (currentLine < lines.length) {
    const line = lines[currentLine];

    if (isComment(line)) {
      const commentText = line.trim().substring(1).trim();
      if (!transactionComment) transactionComment = commentText;
      const tags = extractTags(commentText);
      Object.assign(transactionTags, tags);
      currentLine++;
      continue;
    }

    if (isPosting(line)) {
      const posting = parsePosting(line, header.date, commodities);
      if (posting) {
        posting.line = startLine + currentLine;
        postings.push(posting);
      }
      currentLine++
      continue
    }

    currentLine++;
  }

  const transaction: Transaction = {
    date: header.date,
    description: header.description,
    payee: header.payee,
    note: header.note,
    postings,
    line: startLine
  };

  if (header.effectiveDate) transaction.effectiveDate = header.effectiveDate;
  if (header.status) transaction.status = header.status as any;
  if (header.code) transaction.code = header.code;
  if (header.comment || transactionComment) transaction.comment = header.comment || transactionComment;
  if (Object.keys(transactionTags).length > 0 || header.tags) transaction.tags = { ...transactionTags, ...header.tags };

  // Infer costs for two-commodity transactions
  inferCosts(transaction);

  // Infer amounts for postings without explicit amounts
  inferAmounts(transaction);

  return transaction;
}

/**
 * Infer costs for two-commodity transactions without explicit cost notation.
 *
 * According to hledger docs, when a transaction has:
 * - All postings with amounts specified
 * - Exactly two commodities
 * - No explicit cost notation
 *
 * Then hledger infers a total cost on the first posting to balance the transaction.
 */
export function inferCosts(transaction: Transaction): void {
  // Requirements for cost inference
  if (transaction.postings.length === 0) return;

  // 1. All postings must have amounts
  const allHaveAmounts = transaction.postings.every(p => p.amount);
  if (!allHaveAmounts) return;

  // 2. No posting should already have explicit cost notation
  const hasExplicitCost = transaction.postings.some(p => p.cost);
  if (hasExplicitCost) return;

  // 3. Count distinct commodities
  const commodities = new Set<string>();
  for (const posting of transaction.postings) {
    if (posting.amount) {
      commodities.add(posting.amount.commodity || '');
    }
  }

  // Must have exactly 2 commodities
  if (commodities.size !== 2) return;

  // Get first posting's commodity
  const firstCommodity = transaction.postings[0].amount!.commodity || '';

  // Sum all amounts in the other commodity
  let otherCommodity = '';
  let otherCommodityFormat: Format | undefined;
  let otherSum = 0;

  for (const posting of transaction.postings) {
    const commodity = posting.amount!.commodity || '';
    if (commodity !== firstCommodity) {
      otherCommodity = commodity;
      otherCommodityFormat = posting.amount!.format;
      otherSum += posting.amount!.quantity;
    }
  }

  // Infer total cost: the negation of the sum of other commodity
  // This makes the transaction balance when cost is used for balance calculation
  const costAmount: Amount = {
    quantity: -otherSum,
    commodity: otherCommodity,
    format: otherCommodityFormat,
  };

  // Add inferred total cost to first posting
  transaction.postings[0].cost = {
    type: 'total',
    amount: costAmount,
    inferred: true
  };
}

/**
 * Infer amounts for postings without explicit amounts.
 *
 * According to hledger rules:
 * - At most one posting may omit an amount
 * - The inferred amount is whatever makes the transaction balance to zero
 * - Cost conversions are considered when calculating the balance
 */
export function inferAmounts(transaction: Transaction): void {
  // Find real (non-unbalanced-virtual) postings without amounts
  const postingsWithoutAmounts: number[] = [];
  for (let i = 0; i < transaction.postings.length; i++) {
    const p = transaction.postings[i];
    if (p.virtual === 'unbalanced') continue; // Virtual postings don't participate
    if (!p.amount) {
      postingsWithoutAmounts.push(i);
    }
  }

  // Can only infer if exactly one real posting is missing an amount
  if (postingsWithoutAmounts.length !== 1) {
    return;
  }

  const targetIndex = postingsWithoutAmounts[0];

  // Calculate balance from all explicit amounts (excluding unbalanced virtual)
  const balances = new Map<string, number>();

  for (let i = 0; i < transaction.postings.length; i++) {
    if (i === targetIndex) continue; // Skip the posting we're inferring

    const posting = transaction.postings[i];
    if (posting.virtual === 'unbalanced') continue; // Virtual postings don't participate
    if (!posting.amount) continue;

    // If posting has a cost, use the cost commodity for balance calculation
    if (posting.cost) {
      const costCommodity = posting.cost.amount.commodity || '';
      let costValue: number;

      if (posting.cost.type === 'unit') {
        // @ unitPrice: total cost = quantity * unitPrice
        costValue = posting.amount.quantity * posting.cost.amount.quantity;
      } else {
        if (posting.cost.inferred) {
          // @@ totalPrice (inferred): sign is already correct from inferCosts()
          costValue = posting.cost.amount.quantity;
        } else {
          // @@ totalPrice (explicit): sign comes from the posting amount
          // e.g. -10 FUND @@ 1000 USD → -1000 USD, -10 FUND @@ -1000 USD → +1000 USD
          costValue = Math.sign(posting.amount.quantity) * posting.cost.amount.quantity;
        }
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

  // The inferred amount is the negation of the sum (to make transaction balance to zero)
  // For multi-commodity transactions, we can only store one commodity in the amount field
  // For proper validation, we need a different approach, but for now we'll store the first commodity
  // and let the validator handle multi-commodity balance checking
  if (balances.size === 1) {
    // Single commodity - straightforward inference
    const entry = balances.entries().next().value;
    if (entry) {
      const [commodity, balance] = entry;
      transaction.postings[targetIndex].amount = {
        quantity: -balance,
        commodity: commodity,
        inferred: true
      };
    }
  } else if (balances.size > 1) {
    // Multi-commodity - store first commodity for now
    // Note: Real hledger would require explicit amounts for all commodities
    // or use balance assertions. This is a simplification.
    const entry = balances.entries().next().value;
    if (entry) {
      const [commodity, balance] = entry;
      transaction.postings[targetIndex].amount = {
        quantity: -balance,
        commodity: commodity,
        inferred: true
      };
    }
  }
}


// Parse Transaction Header and Helpers
export function parseTransactionHeader(line: string): { date: string; effectiveDate?: string; status?: 'cleared' | 'pending' | 'unmarked'; code?: string; description: string; payee: string; note: string; comment?: string; tags?: Record<string, string> } | null {
  const trimmed = line.trim();

  const dateRes = parseDate(trimmed);
  if (!dateRes) return null;
  let rest = dateRes.rest;

  const effDateRes = parseEffectiveDate(rest);
  rest = effDateRes.rest;

  const statusRes = parseStatus(rest);
  rest = statusRes.rest;

  const codeRes = parseCode(rest);
  rest = codeRes.rest;

  const descRes = parseDescription(rest);
  const { payee, note } = parsePayeeAndNote(descRes.description);

  return {
    date: dateRes.date,
    effectiveDate: effDateRes.effectiveDate,
    status: statusRes.status,
    code: codeRes.code,
    description: descRes.description,
    payee,
    note,
    comment: descRes.comment,
    tags: descRes.tags
  };
}

function parseDate(line: string, defaultYear?: string): { date: string, rest: string } | null {
  // Try full date first: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  const fullMatch = line.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})/);
  if (fullMatch) {
    const dateStr = fullMatch[0];
    return { date: dateStr, rest: line.substring(dateStr.length).trim() };
  }

  // Try short date: M/D, M-D (no dot — dot would be ambiguous with decimals)
  const shortMatch = line.match(/^(\d{1,2})([-/])(\d{1,2})(?=[\s=*!(]|$)/);
  if (shortMatch) {
    const year = defaultYear || new Date().getFullYear().toString();
    // Zero-pad month and day for consistent date format
    const month = shortMatch[1].padStart(2, '0');
    const sep = shortMatch[2];
    const day = shortMatch[3].padStart(2, '0');
    const dateStr = `${year}${sep}${month}${sep}${day}`;
    return { date: dateStr, rest: line.substring(shortMatch[0].length).trim() };
  }

  return null;
}

function parseEffectiveDate(line: string, defaultYear?: string): { effectiveDate?: string, rest: string } {
  // Full date: =YYYY-MM-DD, =YYYY/MM/DD, =YYYY.MM.DD
  const fullMatch = line.match(/^=(\d{4})([-/.])(\d{1,2})\2(\d{1,2})/);
  if (fullMatch) {
    const dateStr = fullMatch[0].substring(1);
    return { effectiveDate: dateStr, rest: line.substring(fullMatch[0].length).trim() };
  }

  // Short date: =M/D, =M-D
  const shortMatch = line.match(/^=(\d{1,2})([-/])(\d{1,2})(?=\s|$)/);
  if (shortMatch) {
    const year = defaultYear || new Date().getFullYear().toString();
    const month = shortMatch[1].padStart(2, '0');
    const sep = shortMatch[2];
    const day = shortMatch[3].padStart(2, '0');
    const dateStr = `${year}${sep}${month}${sep}${day}`;
    return { effectiveDate: dateStr, rest: line.substring(shortMatch[0].length).trim() };
  }

  return { effectiveDate: undefined, rest: line };
}

function parseStatus(line: string): { status?: 'cleared' | 'pending' | 'unmarked', rest: string } {
  if (line.startsWith('*')) return { status: 'cleared', rest: line.substring(1).trim() };
  if (line.startsWith('!')) return { status: 'pending', rest: line.substring(1).trim() };
  return { status: undefined, rest: line };
}

function parseCode(line: string): { code?: string, rest: string } {
  const match = line.match(/^\(([^)]+)\)/);
  if (match) {
    return { code: match[1], rest: line.substring(match[0].length).trim() };
  }
  return { code: undefined, rest: line };
}

function parseDescription(line: string): { description: string, comment?: string, tags?: Record<string, string> } {
  let description = line;
  let comment: string | undefined;
  let tags: Record<string, string> | undefined;

  const match = line.match(/^([^;]*);(.*)$/);
  if (match) {
    description = match[1].trim();
    comment = match[2].trim();
    const extracted = extractTags(comment);
    if (Object.keys(extracted).length > 0) tags = extracted;
  } else {
    description = line.trim();
  }

  return { description, comment, tags };
}

function parsePayeeAndNote(description: string): { payee: string, note: string } {
  const pipeIndex = description.indexOf('|');
  if (pipeIndex !== -1) {
    return {
      payee: description.substring(0, pipeIndex).trim(),
      note: description.substring(pipeIndex + 1).trim()
    };
  }
  return { payee: description, note: description };
}


// Parse Posting and Helpers
export function parsePosting(line: string, transactionDate?: string, commodities?: Map<string, Commodity>): Posting | null {
  if (!isPosting(line)) return null;
  let account = extractAccountFromPosting(line);
  if (!account) return null;
  const posting: Posting = { account };

  // Detect and strip posting-level status markers (* or !)
  if (account.startsWith('* ')) {
    posting.account = account.substring(2);
    posting.status = 'cleared';
    account = posting.account; // Update for downstream virtual posting check
  } else if (account.startsWith('! ')) {
    posting.account = account.substring(2);
    posting.status = 'pending';
    account = posting.account;
  }

  // Detect and strip virtual posting delimiters
  if (posting.account.startsWith('(') && posting.account.endsWith(')')) {
    posting.account = posting.account.substring(1, posting.account.length - 1);
    posting.virtual = 'unbalanced';
  } else if (posting.account.startsWith('[') && posting.account.endsWith(']')) {
    posting.account = posting.account.substring(1, posting.account.length - 1);
    posting.virtual = 'balanced';
  }

  const commentMatch = line.match(/^([^;]*);(.*)$/);
  let mainPart = line;
  let commentPart = '';
  if (commentMatch) {
    mainPart = commentMatch[1];
    commentPart = commentMatch[2];
    posting.comment = commentPart.trim();
    const tags = extractTags(commentPart);
    if (Object.keys(tags).length > 0) posting.tags = tags;

    // Parse posting date from tags or bracketed syntax
    // date: tag takes precedence over [DATE] syntax
    if (posting.tags?.date) {
      const postingDate = parsePostingDate(posting.tags.date, transactionDate);
      if (postingDate) {
        posting.date = postingDate;
        delete posting.tags.date; // Remove from tags (it's metadata, not a user tag)
      }
    }

    // Check for bracketed syntax: [YYYY-MM-DD] or [MM-DD]
    // Only use if date: tag is not present
    if (!posting.date) {
      const bracketedDateMatch = commentPart.match(/\[(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2})\]/);
      if (bracketedDateMatch) {
        const bracketedDate = parsePostingDate(bracketedDateMatch[1], transactionDate);
        if (bracketedDate) {
          posting.date = bracketedDate;
        }
      }
    }
  }

  const trimmed = mainPart.trim();
  const afterAccount = trimmed.substring(account.length).trim();
  if (!afterAccount) return posting;

  // Parse order: amount [@ cost | @@ cost] [= assertion]
  // First, split on assertion (=)
  const assertionMatch = afterAccount.match(/=\s*(.+)$/);
  const beforeAssertion = assertionMatch
    ? afterAccount.substring(0, assertionMatch.index ?? 0).trim()
    : afterAccount;

  if (assertionMatch) {
    const assertionPart = assertionMatch[1].trim();
    const assertionAmount = parseAmount(assertionPart, undefined, commodities);
    if (assertionAmount) posting.assertion = assertionAmount;
  }

  // Now parse amount and cost from beforeAssertion
  const { amountPart, cost } = parseCost(beforeAssertion, commodities);
  if (cost) posting.cost = cost;

  const amount = parseAmount(amountPart, undefined, commodities);
  if (amount) posting.amount = amount;

  return posting;
}

function parsePostingDate(dateStr: string, transactionDate?: string): string | null {
  // Full date: YYYY-MM-DD or YYYY/MM/DD (with 1 or 2 digit months/days)
  const fullDateMatch = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (fullDateMatch) {
    const month = fullDateMatch[2].padStart(2, '0');
    const day = fullDateMatch[3].padStart(2, '0');
    return `${fullDateMatch[1]}-${month}-${day}`;
  }

  // Partial date: MM-DD or MM/DD or M-D or M/D (needs transaction year)
  const partialDateMatch = dateStr.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (partialDateMatch && transactionDate) {
    const txYear = transactionDate.substring(0, 4);
    const month = partialDateMatch[1].padStart(2, '0');
    const day = partialDateMatch[2].padStart(2, '0');
    return `${txYear}-${month}-${day}`;
  }

  return null; // Invalid format
}

function parseCost(text: string, commodities?: Map<string, Commodity>): { amountPart: string, cost?: { type: 'unit' | 'total', amount: Amount } } {
  // Check for @@ first (total price), then @ (unit price)
  const totalCostMatch = text.match(/@@\s*(.+)$/);
  const unitCostMatch = !totalCostMatch ? text.match(/@\s*(.+)$/) : null;

  if (totalCostMatch) {
    const amountPart = text.substring(0, totalCostMatch.index ?? 0).trim();
    const costPart = totalCostMatch[1].trim();
    const costAmount = parseAmount(costPart, undefined, commodities);
    if (costAmount) {
      return { amountPart, cost: { type: 'total', amount: costAmount } };
    }
  } else if (unitCostMatch) {
    const amountPart = text.substring(0, unitCostMatch.index ?? 0).trim();
    const costPart = unitCostMatch[1].trim();
    const costAmount = parseAmount(costPart, undefined, commodities);
    if (costAmount) {
      return { amountPart, cost: { type: 'unit', amount: costAmount } };
    }
  }

  return { amountPart: text.trim() };
}


// Parse amount and Helpers
export function parseAmount(amountStr: string, decimalMark?: DecimalMark, commodities?: Map<string, Commodity>): Amount | null {
  const trimmed = amountStr.trim();
  if (!trimmed) return null;

  // Regex to split commodity and amount
  // We need to be more permissive with the amount part to capture various formats
  // Amount part can contain digits, commas, dots, spaces (maybe)
  // But spaces are tricky. For now let's assume space separates commodity if symbol is on left/right

  // Convert decimalMark from detectNumberFormat (null = no decimal mark) to
  // the format parseNumberWithFormat expects (null → 'none', value → value, undefined → undefined)
  const toMarkArg = (mark: DecimalMark): string | 'none' | undefined =>
    mark === null ? 'none' : mark === undefined ? undefined : mark;

  // Look up the effective decimal mark for a commodity: explicit parameter > commodity directive format > undefined
  const effectiveDecimalMark = (commodity: string): DecimalMark | undefined => {
    if (decimalMark !== undefined) return decimalMark;
    if (commodities && commodity) {
      const commodityInfo = commodities.get(commodity);
      if (commodityInfo?.format?.decimalMark !== undefined) {
        return commodityInfo.format.decimalMark;
      }
    }
    return undefined;
  };

  const patterns = [
    {
      // Symbol on left, with sign prefix (e.g. -$100, +$100, - $100, + $100)
      pattern: /^([+-])\s*([^\d\s+-]+)\s*([+-]?\d[\d.,\s]*)$/,
      handler: (m: RegExpMatchArray) => {
        const sign = m[1];
        const rawAmount = m[3];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, effectiveDecimalMark(m[2]));
        const quantity = parseNumberWithFormat(rawAmount, toMarkArg(mark));
        return { quantity: sign === '-' ? -Math.abs(quantity) : Math.abs(quantity), commodity: m[2], rawAmount };
      },
      cleaner: (_m: RegExpMatchArray, s: string) => s.replace(/^[+-]/, '')
    },
    {
      // Symbol on left
      pattern: /^([^\d\s+-]+)\s*([+-]?\s*\d[\d.,\s]*)$/,
      handler: (m: RegExpMatchArray) => {
        const rawAmount = m[2];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, effectiveDecimalMark(m[1]));
        return { quantity: parseNumberWithFormat(rawAmount, toMarkArg(mark)), commodity: m[1], rawAmount };
      },
      cleaner: (m: RegExpMatchArray, s: string) => s.replace(m[2], m[2].replace(/[+-]/, ''))
    },
    {
      // Symbol on right
      pattern: /^([+-]?\s*\d[\d.,\s]*)\s*([^\d\s]+)$/,
      handler: (m: RegExpMatchArray) => {
        const rawAmount = m[1];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, effectiveDecimalMark(m[2]));
        return { quantity: parseNumberWithFormat(rawAmount, toMarkArg(mark)), commodity: m[2], rawAmount };
      },
      cleaner: (m: RegExpMatchArray, s: string) => s.replace(m[1], m[1].replace(/[+-]/, ''))
    },
    {
      // No symbol
      pattern: /^([+-]?\s*\d[\d.,\s]*)$/,
      handler: (m: RegExpMatchArray) => {
        const rawAmount = m[1];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, effectiveDecimalMark(''));
        return { quantity: parseNumberWithFormat(rawAmount, toMarkArg(mark)), commodity: '', rawAmount };
      },
      cleaner: (m: RegExpMatchArray, s: string) => s.replace(m[1], m[1].replace(/[+-]/, ''))
    }
  ];

  for (const { pattern, handler, cleaner } of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      // Verify that the amount part looks valid (e.g. not just a dot)
      // and doesn't contain internal spaces that look like commodity separators
      // This is a heuristic.

      const res = handler(match);
      if (isNaN(res.quantity)) continue;

      const amount: Amount = { quantity: res.quantity, commodity: res.commodity };

      let sampleForFormat = trimmed;
      // Strip sign before parsing format to avoid treating +/- as commodity symbol
      // Check both the full input and the raw amount part for signs
      if (/^[+-]/.test(trimmed) || /^[+-]/.test(res.rawAmount)) {
        sampleForFormat = cleaner(match, trimmed);
      }

      const parsedFormat = parseFormat(sampleForFormat);
      if (parsedFormat && parsedFormat.format) {
        amount.format = parsedFormat.format;
      }

      return amount;
    }
  }

  return null;
}

/**
 * Helper to detect decimal mark and thousands separator from a number string.
 */
function detectNumberFormat(numStr: string, defaultDecimalMark?: DecimalMark): { decimalMark: DecimalMark, thousandsSeparator: ThousandsSeparator } {
  let decimalMark: DecimalMark | undefined;

  const lastDot = numStr.lastIndexOf('.');
  const lastComma = numStr.lastIndexOf(',');

  if (lastDot > -1 && lastComma > -1) {
    // Both separators present — unambiguous: last one is decimal
    decimalMark = lastDot > lastComma ? '.' : ',';
  } else if (lastDot > -1) {
    const parts = numStr.split('.');
    if (parts.length > 2) {
      decimalMark = null; // Multiple dots → thousands separator, no decimal
    } else {
      // Single dot: ambiguous if exactly 3 trailing digits (could be thousands)
      const trailing = parts[1];
      if (trailing.length === 3 && defaultDecimalMark !== undefined) {
        decimalMark = defaultDecimalMark;
      } else {
        decimalMark = '.';
      }
    }
  } else if (lastComma > -1) {
    const parts = numStr.split(',');
    if (parts.length > 2) {
      decimalMark = null; // Multiple commas → thousands separator, no decimal
    } else {
      // Single comma: ambiguous if exactly 3 trailing digits (could be thousands)
      const trailing = parts[1];
      if (trailing.length === 3 && defaultDecimalMark !== undefined) {
        decimalMark = defaultDecimalMark;
      } else {
        decimalMark = ',';
      }
    }
  } else {
    decimalMark = null; // No separators at all
  }

  // Detect thousands separator
  // It should be the other separator if present
  // We need to look at the integer part only
  let integerPart = numStr;
  if (decimalMark) {
    const lastIndex = numStr.lastIndexOf(decimalMark);
    if (lastIndex >= 0) {
      integerPart = numStr.substring(0, lastIndex);
    }
  }

  const sepCounts: Record<string, number> = {};
  for (let i = 0; i < integerPart.length; i++) {
    const ch = integerPart[i];
    if (ch < '0' || ch > '9') sepCounts[ch] = (sepCounts[ch] || 0) + 1;
  }

  let thousandsSeparator: ThousandsSeparator = null;
  const separators = Object.keys(sepCounts);

  // If we have a decimal mark, the thousands separator must be different
  // Filter out the decimal mark from potential separators just in case
  const potentialSeparators = separators.filter(s => s !== decimalMark);

  if (potentialSeparators.length === 1) {
    const candidate = potentialSeparators[0];
    // Only accept valid thousand separators: '.', ',', ' '
    if (candidate === '.' || candidate === ',' || candidate === ' ') {
      thousandsSeparator = candidate;
    }
  } else if (potentialSeparators.length > 1) {
    let max = 0;
    let pick: ThousandsSeparator = null;
    for (const k of potentialSeparators) {
      // Only consider valid thousand separators
      if ((k === '.' || k === ',' || k === ' ') && sepCounts[k] > max) {
        max = sepCounts[k];
        pick = k;
      }
    }
    thousandsSeparator = pick;
  }

  return { decimalMark, thousandsSeparator };
}

/**
 * Helper to parse number string given a decimal mark.
 *
 * @param numStr The raw number string (e.g., "18,000,000", "1.000,50")
 * @param mark The decimal mark character, or 'none' if detectNumberFormat
 *             determined there is no decimal mark (all separators are thousands).
 *             If undefined, the function will attempt to auto-detect.
 */
function parseNumberWithFormat(numStr: string, mark: string | 'none' | undefined): number {
  if (mark === 'none') {
    // No decimal mark — all separators are thousands separators.
    // Strip everything that isn't a digit or sign.
    const cleanStr = numStr.replace(/[^0-9+-]/g, '');
    return parseFloat(cleanStr);
  }

  if (!mark) {
    // Auto-detect: if no mark provided, treat the last separator as decimal.
    // This matches hledger's default behavior for ambiguous amounts like "1,000" or "1.000".
    const lastDot = numStr.lastIndexOf('.');
    const lastComma = numStr.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      mark = lastDot > lastComma ? '.' : ',';
    } else if (lastDot > -1) {
      mark = '.';
    } else if (lastComma > -1) {
      mark = ',';
    }
  }

  let cleanStr = numStr;
  if (mark) {
    // Remove everything that is NOT the decimal mark, digit, or sign (+/-)
    // This effectively removes thousands separators
    const regex = new RegExp(`[^0-9${mark === '.' ? '\\.' : ','}+-]`, 'g');
    cleanStr = numStr.replace(regex, '');
    // Replace decimal mark with dot for JS parseFloat
    if (mark === ',') {
      cleanStr = cleanStr.replace(',', '.');
    }
  } else {
    // No separators found, just parse
    cleanStr = numStr.replace(/[^0-9.+-]/g, '');
  }
  return parseFloat(cleanStr);
}

export function parseFormat(sample: string): { name: string; format?: Format } | null {
  if (!sample) return null;
  const s = sample.trim();

  const stripQuotes = (s: string) => { const t = s.trim(); if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.substring(1, t.length - 1); return t; };

  const firstDigit = s.search(/\d/);
  if (firstDigit === -1) {
    return { name: stripQuotes(s) };
  }
  const allowed = /[0-9.,\u00A0\s]/;
  let start = firstDigit; let end = start;
  while (end < s.length && allowed.test(s[end])) end++;
  const leftRaw = s.substring(0, start).trim(); const numberRaw = s.substring(start, end).trim(); const rightRaw = s.substring(end).trim();
  if (!numberRaw) return null;

  const { decimalMark, thousandsSeparator } = detectNumberFormat(numberRaw);

  let decimalIndex = -1;
  if (decimalMark) {
    decimalIndex = numberRaw.lastIndexOf(decimalMark);
  }

  const fractionalPart = decimalIndex >= 0 ? numberRaw.substring(decimalIndex + 1) : '';
  const precision = decimalIndex >= 0 ? (fractionalPart.length > 0 ? fractionalPart.length : 0) : null;

  let rawSymbol = leftRaw || rightRaw || ''; rawSymbol = stripQuotes(rawSymbol);
  const symbolOnLeft = Boolean(leftRaw);
  let spaceBetween = false;
  if (symbolOnLeft) { const between = s.substring(0, firstDigit); spaceBetween = /\s/.test(between.replace(stripQuotes(leftRaw), '')) || /\s/.test(leftRaw.slice(-1)); }
  else { const after = s.substring(end); spaceBetween = /\s/.test(after.replace(stripQuotes(rightRaw), '')) || /\s/.test(s[end - 1]); }
  const format: Format = { symbol: rawSymbol, symbolOnLeft, spaceBetween, decimalMark, thousandsSeparator, precision };
  let name = rawSymbol;
  if (rightRaw) {
    const candidate = stripQuotes(rightRaw);
    if (/^[A-Za-z][A-Za-z0-9 _-]*$/.test(candidate) || (rightRaw.trim().startsWith('"') && rightRaw.trim().endsWith('"'))) name = candidate;
  }
  if (rawSymbol === '""') name = '';
  return { name, format };
}


//Process Directives
export function parseDirective(line: string): Directive | null {
  const trimmed = line.trim();

  // Extract comment if present
  const commentMatch = trimmed.match(/^([^;]*);(.*)$/);
  const mainPart = commentMatch ? commentMatch[1].trim() : trimmed;
  const comment = commentMatch ? commentMatch[2].trim() : undefined;

  // Parse directive type and value
  const directives: Array<Directive['type']> = ['account', 'commodity', 'payee', 'tag', 'include', 'alias'];

  for (const directiveType of directives) {
    if (mainPart.startsWith(directiveType + ' ')) {
      const value = mainPart.substring(directiveType.length + 1).trim();
      if (value) {
        return {
          type: directiveType,
          value,
          comment
        };
      }
    }
  }

  return null;
}

export function processAccountDirective(line: string, accountMap: Map<string, Account>, sourceUri?: URI, lineNumber?: number): void {
  const accountName = line.trim().substring(8).split(';')[0].trim();
  if (accountName) {
    addAccount(accountMap, accountName, true, sourceUri, lineNumber);
  }
}

export function processPayeeDirective(line: string, payeeMap: Map<string, Payee>, sourceUri?: URI, lineNumber?: number): void {
  const payeeName = line.trim().substring(6).split(';')[0].trim();
  if (payeeName) {
    addPayee(payeeMap, payeeName, true, sourceUri, lineNumber);
  }
}

export function processTagDirective(line: string, tagMap: Map<string, Tag>, sourceUri?: URI, lineNumber?: number): void {
  const tagName = line.trim().substring(4).split(';')[0].trim();
  if (tagName) {
    addTag(tagMap, tagName, true, sourceUri, lineNumber);
  }
}

export function processTransaction(transaction: Transaction, accountMap: Map<string, Account>, commodityMap: Map<string, Commodity>, tagMap: Map<string, Tag>, sourceUri?: URI): void {
  // Extract payee is handled separately since it's in the transaction header

  // Extract accounts and commodities from postings
  for (const posting of transaction.postings) {
    // Add account
    if (posting.account) {
      addAccount(accountMap, posting.account, false, sourceUri);
    }

    // Add commodity from amount
    if (posting.amount?.commodity && posting.amount.commodity !== '') {
      addCommodity(commodityMap, posting.amount.commodity, false, posting.amount.format, sourceUri);
    }

    // Add commodity from cost
    if (posting.cost?.amount?.commodity && posting.cost.amount.commodity !== '') {
      addCommodity(commodityMap, posting.cost.amount.commodity, false, posting.cost.amount.format, sourceUri);
    }

    // Add commodity from balance assertion
    if (posting.assertion?.commodity && posting.assertion.commodity !== '') {
      addCommodity(commodityMap, posting.assertion.commodity, false, posting.assertion.format, sourceUri);
    }

    // Extract tags from posting comments
    if (posting.tags) {
      for (const tagName of Object.keys(posting.tags)) {
        addTag(tagMap, tagName, false, sourceUri);
      }
    }
  }

  // Extract tags from transaction-level tags
  if (transaction.tags) {
    for (const tagName of Object.keys(transaction.tags)) {
      addTag(tagMap, tagName, false, sourceUri);
    }
  }
}

export function processCommodityDirective(lines: string[], startLine: number, commodityMap: Map<string, Commodity>, sourceUri?: URI): number {
  const line = lines[startLine];
  const parsed = parseCommodityDirective(line);
  if (!parsed) return startLine;

  let commodityName = parsed.name;
  let format = parsed.format;

  // Check for format subdirective on following lines
  let look = startLine + 1;
  while (look < lines.length) {
    const next = lines[look];
    if (!next.trim()) { look++; continue; }
    if (!/^\s+/.test(next)) break;

    const subParsed = parseFormatSubDirective(next);
    if (subParsed) {
      if (subParsed.format) format = subParsed.format;
      if (subParsed.name && subParsed.name !== '' && (!commodityName || commodityName === '' || commodityName === subParsed.name)) {
        commodityName = subParsed.name;
      }
    }
    look++;
  }

  addCommodity(commodityMap, commodityName, true, format, sourceUri, startLine);

  // Return the last line we processed
  return look - 1;
}

function parseCommodityDirective(line: string): { name: string, format?: Format } | null {
  const directive = line.trim().substring(10).split(';')[0].trim();
  if (!directive) return null;

  let parsed = null;
  if (/\d/.test(directive)) parsed = parseFormat(directive);

  if (parsed) {
    return { name: parsed.name, format: parsed.format };
  } else {
    return { name: stripQuotes(directive), format: undefined };
  }
}

function parseFormatSubDirective(line: string): { name?: string, format?: Format } | null {
  const trimmedNext = line.trim();
  if (!trimmedNext.startsWith('format ')) return null;

  const rest = trimmedNext.substring(7).trim();
  const m = rest.match(/^(".*?"|\S+)\s+(.*)$/);
  if (m) {
    const formatSymbolRaw = m[1]; const samplePart = m[2];
    const parsedFormat = parseFormat(samplePart) || parseFormat(`${samplePart} ${formatSymbolRaw}`);
    if (parsedFormat && parsedFormat.format) {
      const fs = stripQuotes(formatSymbolRaw);
      return { name: fs, format: parsedFormat.format };
    }
  }
  // If no match, try parsing rest directly as a format sample (e.g., "format $1,000.00")
  const parsedDirect = parseFormat(rest);
  if (parsedDirect && parsedDirect.format) {
    return { name: parsedDirect.name, format: parsedDirect.format };
  }
  return null;
}


// Helper functions for incremental parsing - adding items to Maps
export function addAccount(accountMap: Map<string, Account>, name: string, declared: boolean, sourceUri?: URI, line?: number): void {

  const existing = accountMap.get(name);
  if (existing) {
    // If we're adding a declared version, update the existing entry
    if (declared && !existing.declared) {
      existing.declared = true;
      if (sourceUri !== undefined) existing.sourceUri = sourceUri;
      if (line !== undefined) existing.line = line;
    }
  } else {
    const acc: Account = { name, declared };
    if (sourceUri !== undefined) { acc.sourceUri = sourceUri; acc.line = line; }
    accountMap.set(name, acc);
  }
}

export function addPayee(payeeMap: Map<string, Payee>, name: string, declared: boolean, sourceUri?: URI, line?: number): void {
  const existing = payeeMap.get(name);
  if (existing) {
    if (declared && !existing.declared) {
      existing.declared = true;
      if (sourceUri !== undefined) existing.sourceUri = sourceUri;
      if (line !== undefined) existing.line = line;
    }
  } else {
    const p: Payee = { name, declared };
    if (sourceUri !== undefined) { p.sourceUri = sourceUri; p.line = line; }
    payeeMap.set(name, p);
  }
}

export function addCommodity(commodityMap: Map<string, Commodity>, name: string, declared: boolean, format?: Format, sourceUri?: URI, line?: number): void {
  const existing = commodityMap.get(name);
  if (existing) {
    if (declared) {
      existing.declared = true;
      if (format) existing.format = format;
      if (sourceUri !== undefined) existing.sourceUri = sourceUri;
      if (line !== undefined) existing.line = line;
    } else if (format && !existing.declared) {
      // For undeclared commodities, keep the format with better precision
      const newPrecision = format.precision ?? null;
      const existingPrecision = existing.format?.precision ?? null;
      if (!existing.format || (newPrecision !== null && (existingPrecision === null || newPrecision > existingPrecision))) {
        existing.format = format;
      }
    }
  } else {
    const c: Commodity = { name, declared, format };
    if (sourceUri !== undefined) { c.sourceUri = sourceUri; c.line = line; }
    commodityMap.set(name, c);
  }
}

export function addTag(tagMap: Map<string, Tag>, name: string, declared: boolean, sourceUri?: URI, line?: number): void {
  const existing = tagMap.get(name);
  if (existing) {
    if (declared && !existing.declared) {
      existing.declared = true;
      if (sourceUri !== undefined) existing.sourceUri = sourceUri;
      if (line !== undefined) existing.line = line;
    }
  } else {
    const t: Tag = { name, declared };
    if (sourceUri !== undefined) { t.sourceUri = sourceUri; t.line = line; }
    tagMap.set(name, t);
  }
}
