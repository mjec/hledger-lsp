/**
 * Generators for synthetic hledger journal content, used in performance benchmarks.
 */

/**
 * Options for generating a full journal.
 */
export interface GenerateJournalOptions {
  /** Number of account declarations (default: 20) */
  accountCount?: number;
  /** Number of commodity declarations (default: 3) */
  commodityCount?: number;
  /** Number of payee declarations (default: 10) */
  payeeCount?: number;
  /** Pool of account names to use in postings (derived from accountCount if not provided) */
  accountPool?: string[];
  /** Pool of commodity symbols (derived from commodityCount if not provided) */
  commodityPool?: string[];
  /** Pool of payee names (derived from payeeCount if not provided) */
  payeePool?: string[];
}

/**
 * Build a pool of hierarchical account names.
 */
export function buildAccountPool(count: number): string[] {
  const tops = ['assets', 'liabilities', 'expenses', 'income', 'equity'];
  const subs = ['checking', 'savings', 'credit', 'cash', 'food', 'rent', 'utilities',
    'transport', 'entertainment', 'clothing', 'medical', 'insurance', 'taxes',
    'donations', 'salary', 'bonus', 'investments', 'loans', 'mortgage', 'misc'];
  const pool: string[] = [];
  for (let i = 0; i < count; i++) {
    const top = tops[i % tops.length];
    const sub = subs[i % subs.length];
    pool.push(`${top}:${sub}:sub${i}`);
  }
  return pool;
}

/**
 * Build a pool of commodity symbols.
 */
export function buildCommodityPool(count: number): string[] {
  const base = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK'];
  const pool: string[] = [];
  for (let i = 0; i < count; i++) {
    pool.push(i < base.length ? base[i] : `C${i}`);
  }
  return pool;
}

/**
 * Build a pool of payee names.
 */
export function buildPayeePool(count: number): string[] {
  const pool: string[] = [];
  for (let i = 0; i < count; i++) {
    pool.push(`Payee ${i}`);
  }
  return pool;
}

/**
 * Generate a single transaction with 2–3 postings.
 * Dates are spread across 2020–2025.
 */
export function generateTransaction(
  index: number,
  accountPool: string[],
  commodityPool: string[],
  payeePool: string[],
): string {
  const year = 2020 + (index % 6);
  const month = String((index % 12) + 1).padStart(2, '0');
  const day = String((index % 28) + 1).padStart(2, '0');
  const payee = payeePool[index % payeePool.length];
  const commodity = commodityPool[index % commodityPool.length];
  const acct1 = accountPool[index % accountPool.length];
  const acct2 = accountPool[(index + 1) % accountPool.length];
  const amount = ((index % 900) + 10) + '.' + String(index % 100).padStart(2, '0');

  let lines = `${year}-${month}-${day} ${payee}\n`;
  lines += `    ${acct1}    ${amount} ${commodity}\n`;
  lines += `    ${acct2}\n`;

  // Every 3rd transaction gets a third posting to exercise more complex balancing
  if (index % 3 === 0) {
    const acct3 = accountPool[(index + 2) % accountPool.length];
    // Split the first posting's amount
    const half = ((index % 450) + 5) + '.' + String(index % 100).padStart(2, '0');
    lines = `${year}-${month}-${day} ${payee}\n`;
    lines += `    ${acct1}    ${half} ${commodity}\n`;
    lines += `    ${acct3}    ${half} ${commodity}\n`;
    lines += `    ${acct2}\n`;
  }

  return lines;
}

/**
 * Generate a full journal with declarations and transactions.
 */
export function generateJournal(txCount: number, options?: GenerateJournalOptions): string {
  const accountCount = options?.accountCount ?? 20;
  const commodityCount = options?.commodityCount ?? 3;
  const payeeCount = options?.payeeCount ?? 10;

  const accountPool = options?.accountPool ?? buildAccountPool(accountCount);
  const commodityPool = options?.commodityPool ?? buildCommodityPool(commodityCount);
  const payeePool = options?.payeePool ?? buildPayeePool(payeeCount);

  const parts: string[] = [];

  // Account declarations
  for (const acct of accountPool) {
    parts.push(`account ${acct}`);
  }
  parts.push('');

  // Commodity declarations
  for (const comm of commodityPool) {
    parts.push(`commodity 1,000.00 ${comm}`);
  }
  parts.push('');

  // Payee declarations
  for (const payee of payeePool) {
    parts.push(`payee ${payee}`);
  }
  parts.push('');

  // Price directives (one per commodity pair)
  for (let i = 1; i < commodityPool.length; i++) {
    parts.push(`P 2024-01-01 ${commodityPool[i]} 1.${i}0 ${commodityPool[0]}`);
  }
  parts.push('');

  // Transactions
  for (let i = 0; i < txCount; i++) {
    parts.push(generateTransaction(i, accountPool, commodityPool, payeePool));
  }

  return parts.join('\n');
}

/**
 * Generate a workspace with multiple files and a root that includes them all.
 * Returns a Map of relativePath → content.
 */
export function generateWorkspaceFiles(
  fileCount: number,
  txnsPerFile: number,
): Map<string, string> {
  const files = new Map<string, string>();
  const accountPool = buildAccountPool(fileCount * 5);
  const commodityPool = buildCommodityPool(3);
  const payeePool = buildPayeePool(fileCount * 2);

  // Root file with includes
  const includeLines: string[] = [];
  for (let f = 0; f < fileCount; f++) {
    includeLines.push(`include sub${f}.journal`);
  }
  // Root also has shared declarations
  const rootParts = [...includeLines, ''];
  for (const acct of accountPool) {
    rootParts.push(`account ${acct}`);
  }
  rootParts.push('');
  for (const comm of commodityPool) {
    rootParts.push(`commodity 1,000.00 ${comm}`);
  }
  rootParts.push('');
  for (const payee of payeePool) {
    rootParts.push(`payee ${payee}`);
  }
  files.set('main.journal', rootParts.join('\n'));

  // Sub-files with transactions only
  for (let f = 0; f < fileCount; f++) {
    const txLines: string[] = [];
    for (let t = 0; t < txnsPerFile; t++) {
      const globalIndex = f * txnsPerFile + t;
      txLines.push(generateTransaction(globalIndex, accountPool, commodityPool, payeePool));
    }
    files.set(`sub${f}.journal`, txLines.join('\n'));
  }

  return files;
}
