import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { ParsedDocument, Posting, Transaction, PeriodicTransaction } from '../../types';
import { calculateTransactionBalance } from '../../utils/balanceCalculator';
import { formatAmount } from '../../utils/amountFormatter';
import { getLineRange, getTransactionRange } from './utils';

function validateBalance(
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

  const realPostings = postings.filter(p => p.virtual !== 'unbalanced');
  let postingsWithExplicitAmounts = 0;
  for (const posting of realPostings) {
    if (posting.amount && !posting.amount.inferred) {
      postingsWithExplicitAmounts++;
    }
  }

  const diagnostics: Diagnostic[] = [];
  if (postingsWithExplicitAmounts === realPostings.length) {
    for (const [commodity, balance] of balances.entries()) {
      if (Math.abs(balance) > 0.005) {
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
