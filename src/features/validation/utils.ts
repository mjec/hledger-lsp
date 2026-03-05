import { Transaction } from '../../types';

export function getLineRange(line: number, lines: string[]): { start: { line: number; character: number }; end: { line: number; character: number } } {
    const lineText = line < lines.length ? lines[line] : '';
    return {
        start: { line, character: 0 },
        end: { line, character: lineText.length }
    };
}

export function getTransactionRange(transaction: Transaction, lines: string[]): { start: { line: number; character: number }; end: { line: number; character: number } } {
    // Use the transaction's stored line number directly
    if (transaction.line !== undefined) {
        const line = lines[transaction.line] || '';
        return {
            start: { line: transaction.line, character: 0 },
            end: { line: transaction.line, character: line.length }
        };
    }

    // Fallback to first line if no line number available
    return {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
    };
}

export function findFirstOccurrence(lines: string[], searchStr: string): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
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
