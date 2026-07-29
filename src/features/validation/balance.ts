import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { ParsedDocument, Posting, Transaction, PeriodicTransaction } from '../../types';
import { calculateTransactionBalance, commodityPrecisions, balanceTolerance } from '../../utils/balanceCalculator';
import { formatAmount } from '../../utils/amountFormatter';
import { getLineRange, getTransactionRange } from './utils';
import { balancingGroupOf } from '../../parser/ast';

/**
 * Check that one balancing group sums to zero in every commodity.
 *
 * The postings passed in are a single group; `(unbalanced)` postings never reach
 * here because they take no part in balancing.
 */
function validateGroupBalance(
  postings: Posting[],
  line: number | undefined,
  lines: string[],
  parsedDoc: ParsedDocument,
  label: string,
  getRange: (lines: string[]) => { start: { line: number; character: number }; end: { line: number; character: number } }
): Diagnostic[] {
  const tempTransaction: Transaction = {
    date: '', description: '', payee: '', note: '',
    postings, line,
  };
  const balances = calculateTransactionBalance(tempTransaction);

  // Only check a group whose every amount is pinned down. An auto-balanced
  // posting is by definition whatever makes the sum zero, so there is nothing to
  // report. A balance *assignment* is different: its amount comes from the
  // asserted balance, so a transaction built only from assignments can genuinely
  // fail to balance, and hledger reports it.
  const hasDeterminedAmount = (posting: Posting): boolean =>
    Boolean(posting.amount && (!posting.amount.inferred || posting.isBalanceAssignment));

  if (postings.some(p => !hasDeterminedAmount(p))) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const precisions = commodityPrecisions(postings);

  for (const [commodity, balance] of balances.entries()) {
    if (Math.abs(balance) > balanceTolerance(precisions.get(commodity) ?? 0)) {
      const formattedBalance = commodity
        ? formatAmount(balance, commodity, parsedDoc)
        : balance.toFixed(2);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: getRange(lines),
        message: `${label} does not balance: ${formattedBalance} off`,
        source: 'hledger'
      });
    }
  }

  return diagnostics;
}

/**
 * Check a transaction's balance.
 *
 * Real postings and `[balanced virtual]` postings form separate balancing groups
 * that must each sum to zero, so they are checked independently — verified against
 * hledger 1.52.1, which rejects `[v] 10 / a 1 / b` even though the real postings
 * balance, and also rejects a real group of +5 against a virtual group of -5 whose
 * combined total is zero.
 */
function validateBalance(
  postings: Posting[],
  line: number | undefined,
  lines: string[],
  parsedDoc: ParsedDocument,
  label: string,
  getRange: (lines: string[]) => { start: { line: number; character: number }; end: { line: number; character: number } }
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const group of ['real', 'balanced'] as const) {
    const groupPostings = postings.filter(p => balancingGroupOf(p) === group);
    if (groupPostings.length === 0) continue;
    diagnostics.push(...validateGroupBalance(groupPostings, line, lines, parsedDoc, label, getRange));
  }

  return diagnostics;
}

export function validateNonPeriodicBalance(transaction: Transaction, lines: string[], parsedDoc: ParsedDocument): Diagnostic[] {
  return validateBalance(
    transaction.postings, transaction.line, lines, parsedDoc,
    'Transaction', (ls) => getTransactionRange(transaction, ls)
  );
}

export function validatePeriodicTransactionBalance(periodicTx: PeriodicTransaction, lines: string[], parsedDoc: ParsedDocument): Diagnostic[] {
  return validateBalance(
    periodicTx.postings, periodicTx.line, lines, parsedDoc,
    'Periodic transaction', (ls) => getLineRange(periodicTx.line ?? 0, ls)
  );
}
