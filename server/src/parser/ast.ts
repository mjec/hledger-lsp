import { Transaction, Posting, Amount, Cost, Account, Payee, Commodity, Tag, Directive } from '../types';
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
  let otherSum = 0;

  for (const posting of transaction.postings) {
    const commodity = posting.amount!.commodity || '';
    if (commodity !== firstCommodity) {
      otherCommodity = commodity;
      otherSum += posting.amount!.quantity;
    }
  }

  // Infer total cost: the negation of the sum of other commodity
  // This makes the transaction balance when cost is used for balance calculation
  const costAmount: Amount = {
    quantity: -otherSum,
    commodity: otherCommodity
  };

  // Add inferred total cost to first posting
  transaction.postings[0].cost = {
    type: 'total',
    amount: costAmount
  };
}

export function parseTransactionHeader(line: string): { date: string; effectiveDate?: string; status?: 'cleared' | 'pending' | 'unmarked'; code?: string; description: string; payee: string; note: string; comment?: string; tags?: Record<string, string> } | null {
  const trimmed = line.trim();
  const dateMatch = trimmed.match(/^(\d{4}[-/]\d{2}[-/]\d{2})/);
  if (!dateMatch) return null;
  const date = dateMatch[1];
  let rest = trimmed.substring(date.length).trim();

  let effectiveDate: string | undefined;
  const effectiveDateMatch = rest.match(/^=(\d{4}[-/]\d{2}[-/]\d{2})/);
  if (effectiveDateMatch) {
    effectiveDate = effectiveDateMatch[1];
    rest = rest.substring(effectiveDateMatch[0].length).trim();
  }

  let status: 'cleared' | 'pending' | 'unmarked' | undefined;
  if (rest.startsWith('*')) { status = 'cleared'; rest = rest.substring(1).trim(); }
  else if (rest.startsWith('!')) { status = 'pending'; rest = rest.substring(1).trim(); }

  let code: string | undefined;
  const codeMatch = rest.match(/^\(([^)]+)\)/);
  if (codeMatch) { code = codeMatch[1]; rest = rest.substring(codeMatch[0].length).trim(); }

  let comment: string | undefined;
  let tags: Record<string, string> | undefined;
  const commentMatch = rest.match(/^([^;]*);(.*)$/);
  if (commentMatch) {
    rest = commentMatch[1].trim();
    comment = commentMatch[2].trim();
    const extracted = extractTags(comment);
    if (Object.keys(extracted).length > 0) tags = extracted;
  }

  const description = rest.trim();

  // Parse payee and note according to hledger spec:
  // If description contains |, split into payee (left) and note (right)
  // If no |, payee and note both equal description
  let payee: string;
  let note: string;
  const pipeIndex = description.indexOf('|');
  if (pipeIndex !== -1) {
    payee = description.substring(0, pipeIndex).trim();
    note = description.substring(pipeIndex + 1).trim();
  } else {
    payee = description;
    note = description;
  }

  return { date, effectiveDate, status, code, description, payee, note, comment, tags };
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
  // Check for @@ first (total price), then @ (unit price)
  const totalCostMatch = beforeAssertion.match(/@@\s*(.+)$/);
  const unitCostMatch = !totalCostMatch ? beforeAssertion.match(/@\s*(.+)$/) : null;

  if (totalCostMatch) {
    // Parse total cost: amount @@ totalCost
    const amountPart = beforeAssertion.substring(0, totalCostMatch.index ?? 0).trim();
    const costPart = totalCostMatch[1].trim();

    const amount = parseAmount(amountPart);
    if (amount) posting.amount = amount;

    const costAmount = parseAmount(costPart);
    if (costAmount) {
      posting.cost = { type: 'total', amount: costAmount };
    }
  } else if (unitCostMatch) {
    // Parse unit cost: amount @ unitCost
    const amountPart = beforeAssertion.substring(0, unitCostMatch.index ?? 0).trim();
    const costPart = unitCostMatch[1].trim();

    const amount = parseAmount(amountPart);
    if (amount) posting.amount = amount;

    const costAmount = parseAmount(costPart);
    if (costAmount) {
      posting.cost = { type: 'unit', amount: costAmount };
    }
  } else {
    // No cost notation, just parse amount
    const amount = parseAmount(beforeAssertion);
    if (amount) posting.amount = amount;
  }

  return posting;
}

export function parseAmount(amountStr: string): Amount | null {
  const trimmed = amountStr.trim();
  if (!trimmed) return null;

  const patterns = [
    { pattern: /^-([^\d\s-]+)\s*(\d+(?:[,]\d{3})*(?:\.\d+)?)$/, handler: (m: RegExpMatchArray) => ({ quantity: -parseFloat(m[2].replace(/,/g, '')), commodity: m[1] }) },
    { pattern: /^([^\d\s-]+)\s*([-]?\d+(?:[,]\d{3})*(?:\.\d+)?)$/, handler: (m: RegExpMatchArray) => ({ quantity: parseFloat(m[2].replace(/,/g, '')), commodity: m[1] }) },
    { pattern: /^([-]?\d+(?:[,]\d{3})*(?:\.\d+)?)\s*([^\d\s]+)$/, handler: (m: RegExpMatchArray) => ({ quantity: parseFloat(m[1].replace(/,/g, '')), commodity: m[2] }) },
    { pattern: /^([-]?\d+(?:[,]\d{3})*(?:\.\d+)?)$/, handler: (m: RegExpMatchArray) => ({ quantity: parseFloat(m[1].replace(/,/g, '')), commodity: '' }) }
  ];

  for (const { pattern, handler } of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const res = handler(match);
      if (isNaN(res.quantity)) return null;
      return { quantity: res.quantity, commodity: res.commodity } as Amount;
    }
  }

  return null;
}

export function extractAccounts(document: TextDocument, sourceUri?: string): Account[] {
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
  return Array.from(accountMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function extractPayees(document: TextDocument, sourceUri?: string): Payee[] {
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
  return Array.from(payeeMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function extractCommodities(document: TextDocument, sourceUri?: string): Commodity[] {
  const text = document.getText();
  const lines = text.split('\n');
  const commodityMap = new Map<string, Commodity>();
  const stripQuotes = (s: string) => { const t = s.trim(); if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.substring(1, t.length - 1); return t; };

  const parseCommoditySample = (sample: string): { name: string; format?: Commodity['format'] } | null => {
    if (!sample) return null;
    const s = sample.trim();
    const firstDigit = s.search(/\d/);
    if (firstDigit === -1) return null;
    const allowed = /[0-9.,\u00A0\s]/;
    let start = firstDigit; let end = start;
    while (end < s.length && allowed.test(s[end])) end++;
    const leftRaw = s.substring(0, start).trim(); const numberRaw = s.substring(start, end).trim(); const rightRaw = s.substring(end).trim();
    if (!numberRaw) return null;
    const lastDot = numberRaw.lastIndexOf('.'); const lastComma = numberRaw.lastIndexOf(',');
    let decimalMark: '.' | ',' | undefined; let decimalIndex = -1;
    if (lastDot === -1 && lastComma === -1) decimalMark = undefined;
    else if (lastDot > lastComma) { decimalMark = '.'; decimalIndex = lastDot; } else { decimalMark = ','; decimalIndex = lastComma; }
    const integerPart = decimalIndex >= 0 ? numberRaw.substring(0, decimalIndex) : numberRaw;
    const fractionalPart = decimalIndex >= 0 ? numberRaw.substring(decimalIndex + 1) : '';
    const precision = decimalIndex >= 0 ? (fractionalPart.length > 0 ? fractionalPart.length : 0) : null;
    const sepCounts: Record<string, number> = {};
    for (let i = 0; i < integerPart.length; i++) { const ch = integerPart[i]; if (ch < '0' || ch > '9') sepCounts[ch] = (sepCounts[ch] || 0) + 1; }
    let thousandsSeparator: string | null = null; const separators = Object.keys(sepCounts);
    if (separators.length === 1) thousandsSeparator = separators[0]; else if (separators.length > 1) { let max = 0; let pick: null | string = null; for (const k of separators) { if (sepCounts[k] > max) { max = sepCounts[k]; pick = k; } } thousandsSeparator = pick; }
    let rawSymbol = leftRaw || rightRaw || ''; rawSymbol = stripQuotes(rawSymbol);
    const symbolOnLeft = Boolean(leftRaw);
    let spaceBetween = false;
    if (symbolOnLeft) { const between = s.substring(0, firstDigit); spaceBetween = /\s/.test(between.replace(stripQuotes(leftRaw), '')) || /\s/.test(leftRaw.slice(-1)); }
    else { const after = s.substring(end); spaceBetween = /\s/.test(after.replace(stripQuotes(rightRaw), '')) || /\s/.test(s[end - 1]); }
    const format: Commodity['format'] = { symbol: rawSymbol, symbolOnLeft, spaceBetween, decimalMark: decimalMark as any, thousandsSeparator: thousandsSeparator || null, precision };
    let name = rawSymbol;
    if (rightRaw) {
      const candidate = stripQuotes(rightRaw);
      if (/^[A-Za-z][A-Za-z0-9 _-]*$/.test(candidate) || (rightRaw.trim().startsWith('"') && rightRaw.trim().endsWith('"'))) name = candidate;
    }
    if (rawSymbol === '""') name = '';
    return { name, format };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('commodity ')) {
      const directive = line.trim().substring(10).split(';')[0].trim();
      if (!directive) continue;
      let parsed = null;
      if (/\d/.test(directive)) parsed = parseCommoditySample(directive);
      let commodityName: string; let format: Commodity['format'] | undefined;
      if (parsed) { commodityName = parsed.name; format = parsed.format; } else { commodityName = stripQuotes(directive); format = undefined; }
      let look = i + 1;
      while (look < lines.length) {
        const next = lines[look];
        if (!next.trim()) { look++; continue; }
        if (!/^\s+/.test(next)) break;
        const trimmedNext = next.trim();
        if (trimmedNext.startsWith('format ')) {
          const rest = trimmedNext.substring(7).trim();
          const m = rest.match(/^(".*?"|\S+)\s+(.*)$/);
          if (m) {
            const formatSymbolRaw = m[1]; const samplePart = m[2];
            const parsedFormat = parseCommoditySample(samplePart) || parseCommoditySample(`${samplePart} ${formatSymbolRaw}`);
            if (parsedFormat && parsedFormat.format) {
              format = parsedFormat.format;
              const fs = stripQuotes(formatSymbolRaw);
              if (fs && fs !== '' && (!commodityName || commodityName === '' || commodityName === fs)) commodityName = fs;
            }
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
  return Array.from(commodityMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function extractTagNames(document: TextDocument, sourceUri?: string): Tag[] {
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
  return Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name));
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
