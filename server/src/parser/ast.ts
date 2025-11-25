import { Transaction, Posting, Amount, Cost, Account, Payee, Commodity, Tag, Directive, decimalMark, thousandsSeparator, Format } from '../types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isPosting, extractAccountFromPosting, extractTags, isTransactionHeader, isComment, isDirective } from '../utils/index';

/**
 * Parse a transaction starting at startLine within lines array.
 * This is a pure helper extracted from HledgerParser.
 */
export function parseTransaction(lines: string[], startLine: number): Transaction | null {
  if (!lines || lines.length === 0 || startLine >= lines.length) {
    return null;
  }

  const headerLine = lines[startLine];
  if (!isTransactionHeader(headerLine)) return null;

  // reuse the header parser below
  const header = parseTransactionHeader(headerLine);
  if (!header) return null;

  const postings: Posting[] = [];
  let currentLine = startLine + 1;
  let transactionComment: string | undefined;
  const transactionTags: Record<string, string> = {};

  while (currentLine < lines.length) {
    const line = lines[currentLine];

    if (isTransactionHeader(line) || (!line.trim().startsWith(';') && !line.trim().startsWith('#') && line.trim() && !isPosting(line))) {
      break;
    }

    if (isComment(line)) {
      const commentText = line.trim().substring(1).trim();
      if (!transactionComment) transactionComment = commentText;
      const tags = extractTags(commentText);
      Object.assign(transactionTags, tags);
      currentLine++;
      continue;
    }

    if (isPosting(line)) {
      const posting = parsePosting(line);
      if (posting) postings.push(posting);
    }

    currentLine++;

    if (!line.trim()) break;
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
    amount: costAmount
  };
}

function parseDate(line: string): { date: string, rest: string } | null {
  const match = line.match(/^(\d{4}[-/]\d{2}[-/]\d{2})/);
  if (!match) return null;
  return { date: match[1], rest: line.substring(match[1].length).trim() };
}

function parseEffectiveDate(line: string): { effectiveDate?: string, rest: string } {
  const match = line.match(/^=(\d{4}[-/]\d{2}[-/]\d{2})/);
  if (match) {
    return { effectiveDate: match[1], rest: line.substring(match[0].length).trim() };
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

function parseCost(text: string): { amountPart: string, cost?: { type: 'unit' | 'total', amount: Amount } } {
  // Check for @@ first (total price), then @ (unit price)
  const totalCostMatch = text.match(/@@\s*(.+)$/);
  const unitCostMatch = !totalCostMatch ? text.match(/@\s*(.+)$/) : null;

  if (totalCostMatch) {
    const amountPart = text.substring(0, totalCostMatch.index ?? 0).trim();
    const costPart = totalCostMatch[1].trim();
    const costAmount = parseAmount(costPart);
    if (costAmount) {
      return { amountPart, cost: { type: 'total', amount: costAmount } };
    }
  } else if (unitCostMatch) {
    const amountPart = text.substring(0, unitCostMatch.index ?? 0).trim();
    const costPart = unitCostMatch[1].trim();
    const costAmount = parseAmount(costPart);
    if (costAmount) {
      return { amountPart, cost: { type: 'unit', amount: costAmount } };
    }
  }

  return { amountPart: text.trim() };
}

export function parsePosting(line: string): Posting | null {
  if (!isPosting(line)) return null;
  const account = extractAccountFromPosting(line);
  if (!account) return null;
  const posting: Posting = { account };

  const commentMatch = line.match(/^([^;]*);(.*)$/);
  let mainPart = line;
  let commentPart = '';
  if (commentMatch) {
    mainPart = commentMatch[1];
    commentPart = commentMatch[2];
    posting.comment = commentPart.trim();
    const tags = extractTags(commentPart);
    if (Object.keys(tags).length > 0) posting.tags = tags;
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
    const assertionAmount = parseAmount(assertionPart);
    if (assertionAmount) posting.assertion = assertionAmount;
  }

  // Now parse amount and cost from beforeAssertion
  const { amountPart, cost } = parseCost(beforeAssertion);
  if (cost) posting.cost = cost;

  const amount = parseAmount(amountPart);
  if (amount) posting.amount = amount;

  return posting;
}

/**
 * Helper to detect decimal mark and thousands separator from a number string.
 */
function detectNumberFormat(numStr: string, defaultDecimalMark?: decimalMark): { decimalMark: decimalMark, thousandsSeparator: string | null } {
  let decimalMark = defaultDecimalMark;

  if (!decimalMark) {
    const lastDot = numStr.lastIndexOf('.');
    const lastComma = numStr.lastIndexOf(',');

    if (lastDot > -1 && lastComma > -1) {
      decimalMark = lastDot > lastComma ? '.' : ',';
    } else if (lastDot > -1) {
      // Check if it's a thousands separator
      const parts = numStr.split('.');
      if (parts.length > 2) {
        decimalMark = null; // Multiple dots -> thousands separator
      } else {
        decimalMark = '.';
      }
    } else if (lastComma > -1) {
      const parts = numStr.split(',');
      if (parts.length > 2) {
        decimalMark = null; // Multiple commas -> thousands separator
      } else {
        decimalMark = ',';
      }
    } else {
      decimalMark = null;
    }
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

  let thousandsSeparator: string | null = null;
  const separators = Object.keys(sepCounts);

  // If we have a decimal mark, the thousands separator must be different
  // Filter out the decimal mark from potential separators just in case
  const potentialSeparators = separators.filter(s => s !== decimalMark);

  if (potentialSeparators.length === 1) {
    thousandsSeparator = potentialSeparators[0];
  } else if (potentialSeparators.length > 1) {
    let max = 0;
    let pick: null | string = null;
    for (const k of potentialSeparators) {
      if (sepCounts[k] > max) {
        max = sepCounts[k];
        pick = k;
      }
    }
    thousandsSeparator = pick;
  }

  return { decimalMark, thousandsSeparator };
}

/**
 * Helper to parse number string given a decimal mark
 */
function parseNumberWithFormat(numStr: string, mark: string | undefined): number {
  if (!mark) {
    // If no mark provided/detected, assume standard float parsing (remove all non-digits/dots/minus)
    // But wait, if no mark, we need to decide what to do.
    // If ambiguous (e.g. 1.000), hledger assumes decimal mark.
    // So we should treat the last separator as decimal if it exists.
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
    // Remove everything that is NOT the decimal mark, digit, or minus
    // This effectively removes thousands separators
    const regex = new RegExp(`[^0-9${mark === '.' ? '\\.' : ','}-]`, 'g');
    cleanStr = numStr.replace(regex, '');
    // Replace decimal mark with dot for JS parseFloat
    if (mark === ',') {
      cleanStr = cleanStr.replace(',', '.');
    }
  } else {
    // No separators found, just parse
    cleanStr = numStr.replace(/[^0-9.-]/g, '');
  }
  return parseFloat(cleanStr);
}

export function parseAmount(amountStr: string, decimalMark?: decimalMark): Amount | null {
  const trimmed = amountStr.trim();
  if (!trimmed) return null;

  // Regex to split commodity and amount
  // We need to be more permissive with the amount part to capture various formats
  // Amount part can contain digits, commas, dots, spaces (maybe)
  // But spaces are tricky. For now let's assume space separates commodity if symbol is on left/right

  const patterns = [
    {
      // Symbol on left, negative
      pattern: /^-([^\d\s-]+)\s*([-]?\d[\d.,\s]*)$/,
      handler: (m: RegExpMatchArray) => {
        const rawAmount = m[2];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, decimalMark);
        return { quantity: -Math.abs(parseNumberWithFormat(rawAmount, mark || undefined)), commodity: m[1], rawAmount };
      },
      cleaner: (m: RegExpMatchArray, s: string) => s.replace(/^-/, '')
    },
    {
      // Symbol on left
      pattern: /^([^\d\s-]+)\s*([-]?\d[\d.,\s]*)$/,
      handler: (m: RegExpMatchArray) => {
        const rawAmount = m[2];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, decimalMark);
        return { quantity: parseNumberWithFormat(rawAmount, mark || undefined), commodity: m[1], rawAmount };
      },
      cleaner: (m: RegExpMatchArray, s: string) => s.replace(m[2], m[2].replace('-', ''))
    },
    {
      // Symbol on right
      pattern: /^([-]?\d[\d.,\s]*)\s*([^\d\s]+)$/,
      handler: (m: RegExpMatchArray) => {
        const rawAmount = m[1];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, decimalMark);
        return { quantity: parseNumberWithFormat(rawAmount, mark || undefined), commodity: m[2], rawAmount };
      },
      cleaner: (m: RegExpMatchArray, s: string) => s.replace(m[1], m[1].replace('-', ''))
    },
    {
      // No symbol
      pattern: /^([-]?\d[\d.,\s]*)$/,
      handler: (m: RegExpMatchArray) => {
        const rawAmount = m[1];
        const { decimalMark: mark } = detectNumberFormat(rawAmount, decimalMark);
        return { quantity: parseNumberWithFormat(rawAmount, mark || undefined), commodity: '', rawAmount };
      },
      cleaner: (m: RegExpMatchArray, s: string) => s.replace(m[1], m[1].replace('-', ''))
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
      if (res.quantity < 0) {
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
  const format: Format = { symbol: rawSymbol, symbolOnLeft, spaceBetween, decimalMark: decimalMark as any, thousandsSeparator: thousandsSeparator || null, precision };
  let name = rawSymbol;
  if (rightRaw) {
    const candidate = stripQuotes(rightRaw);
    if (/^[A-Za-z][A-Za-z0-9 _-]*$/.test(candidate) || (rightRaw.trim().startsWith('"') && rightRaw.trim().endsWith('"'))) name = candidate;
  }
  if (rawSymbol === '""') name = '';
  return { name, format };
}


export function extractAccounts(document: TextDocument, sourceUri?: string): Map<string, Account> {
  const text = document.getText();
  const lines = text.split('\n');
  const accountMap = new Map<string, Account>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('account ')) {
      const accountName = line.trim().substring(8).split(';')[0].trim();
      if (accountName) {
        const acc: Account = { name: accountName, declared: true };
        if (sourceUri !== undefined) { acc.sourceUri = sourceUri; acc.line = i; }
        accountMap.set(accountName, acc);
      }
    }
    if (isPosting(line)) {
      const account = extractAccountFromPosting(line);
      if (account && !accountMap.has(account)) {
        const acc: Account = { name: account, declared: false };
        if (sourceUri !== undefined) { acc.sourceUri = sourceUri; acc.line = i; }
        accountMap.set(account, acc);
      }
    }
  }
  return accountMap;
}

export function extractPayees(document: TextDocument, sourceUri?: string): Map<string, Payee> {
  const text = document.getText();
  const lines = text.split('\n');
  const payeeMap = new Map<string, Payee>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('payee ')) {
      const payeeName = line.trim().substring(6).split(';')[0].trim();
      if (payeeName) {
        const p: Payee = { name: payeeName, declared: true };
        if (sourceUri !== undefined) { p.sourceUri = sourceUri; p.line = i; }
        payeeMap.set(payeeName, p);
      }
    }
    if (isTransactionHeader(line)) {
      const header = parseTransactionHeader(line);
      // Use payee field instead of description (handles | splitting)
      if (header && header.payee && !payeeMap.has(header.payee)) {
        const p: Payee = { name: header.payee, declared: false };
        if (sourceUri !== undefined) { p.sourceUri = sourceUri; p.line = i; }
        payeeMap.set(header.payee, p);
      }
    }
  }
  return payeeMap;
}

const stripQuotes = (s: string) => { const t = s.trim(); if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.substring(1, t.length - 1); return t; };

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
  return null;
}

export function extractCommodities(document: TextDocument, sourceUri?: string): Map<string, Commodity> {
  const text = document.getText();
  const lines = text.split('\n');
  const commodityMap = new Map<string, Commodity>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('commodity ')) {
      const parsed = parseCommodityDirective(line);
      if (!parsed) continue;

      let commodityName = parsed.name;
      let format = parsed.format;

      let look = i + 1;
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

      const key = commodityName;
      if (commodityMap.has(key)) {
        const existing = commodityMap.get(key)!;
        const merged: Commodity = { ...existing, declared: existing.declared || true, format: existing.format || format };
        if (sourceUri !== undefined) { merged.sourceUri = existing.sourceUri || sourceUri; merged.line = existing.line ?? i; }
        commodityMap.set(key, merged);
      } else {
        const c: Commodity = { name: commodityName, declared: true, format };
        if (sourceUri !== undefined) { c.sourceUri = sourceUri; c.line = i; }
        commodityMap.set(key, c);
      }
    }
    if (isPosting(line)) {
      const posting = parsePosting(line);
      if (posting?.amount?.commodity && posting.amount.commodity !== '') {
        const key = posting.amount.commodity;
        if (!commodityMap.has(key)) {
          const c: Commodity = { name: key, declared: false };
          if (sourceUri !== undefined) { c.sourceUri = sourceUri; }
          commodityMap.set(key, c);
        }
      }
      // Also extract commodity from cost notation
      if (posting?.cost?.amount?.commodity && posting.cost.amount.commodity !== '') {
        const key = posting.cost.amount.commodity;
        if (!commodityMap.has(key)) {
          const c: Commodity = { name: key, declared: false };
          if (sourceUri !== undefined) { c.sourceUri = sourceUri; }
          commodityMap.set(key, c);
        }
      }
    }
  }
  return commodityMap;
}

export function extractTagNames(document: TextDocument, sourceUri?: string): Map<string, Tag> {
  const text = document.getText();
  const lines = text.split('\n');
  const tagMap = new Map<string, Tag>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('tag ')) {
      const tagName = line.trim().substring(4).split(';')[0].trim();
      if (tagName) { const t: Tag = { name: tagName, declared: true }; if (sourceUri !== undefined) { t.sourceUri = sourceUri; t.line = i; } tagMap.set(tagName, t); }
    }
    // Standalone or indented comment lines (transaction-level comments)
    if (isComment(line)) {
      const commentText = line.trim().substring(1);
      const extracted = extractTags(commentText);
      for (const k of Object.keys(extracted)) {
        if (!tagMap.has(k)) {
          const t: Tag = { name: k, declared: false };
          if (sourceUri !== undefined) { t.sourceUri = sourceUri; t.line = i; }
          tagMap.set(k, t);
        }
      }
    }
    if (isPosting(line)) {
      // Use parsePosting to extract tags from the posting's comment part only
      const posting = parsePosting(line);
      if (posting?.tags) {
        for (const k of Object.keys(posting.tags)) {
          if (!tagMap.has(k)) {
            const t: Tag = { name: k, declared: false };
            if (sourceUri !== undefined) { t.sourceUri = sourceUri; }
            tagMap.set(k, t);
          }
        }
      }
    }
    if (isTransactionHeader(line)) {
      const m = line.match(/;(.+)$/);
      if (m) {
        const extracted = extractTags(m[1]);
        for (const k of Object.keys(extracted)) { if (!tagMap.has(k)) { const t: Tag = { name: k, declared: false }; if (sourceUri !== undefined) { t.sourceUri = sourceUri; } tagMap.set(k, t); } }
      }
    }
  }
  return tagMap;
}

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


