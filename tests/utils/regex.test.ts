
import { extractAccountFromPosting } from '../../src/utils/index';

describe('extractAccountFromPosting Regex', () => {

    it('should extract account with implicit amount (newline)', () => {
        expect(extractAccountFromPosting('    Expenses:Food')).toBe('Expenses:Food');
    });

    it('should extract account with implicit amount and trailing spaces', () => {
        expect(extractAccountFromPosting('    Expenses:Food   ')).toBe('Expenses:Food');
    });

    it('should extract account separated by 2 spaces', () => {
        expect(extractAccountFromPosting('    Expenses:Food  10 USD')).toBe('Expenses:Food');
    });

    it('should extract account separated by TAB', () => {
        // Hledger allows single tab as 2-space equivalent separator
        expect(extractAccountFromPosting('    Expenses:Food\t10 USD')).toBe('Expenses:Food');
    });

    it('should extract account separated by TAB followed by comment', () => {
        expect(extractAccountFromPosting('    Expenses:Food\t; comment')).toBe('Expenses:Food');
    });

    it('should extract account separated by 2 spaces followed by comment', () => {
        expect(extractAccountFromPosting('    Expenses:Food  ; comment')).toBe('Expenses:Food');
    });

    it('should treat a single space before an amount as part of the account name', () => {
        // hledger ends an account name only at 2+ spaces, a tab, or end of line, so a
        // single space never separates an amount — the whole thing is the account.
        expect(extractAccountFromPosting('    Expenses:Food 10 USD')).toBe('Expenses:Food 10 USD');
    });

    it('should keep account names containing digits after a single space', () => {
        expect(extractAccountFromPosting('    Income:Salary:Employer 401k Match  $-100.00'))
            .toBe('Income:Salary:Employer 401k Match');
        expect(extractAccountFromPosting('    Income:Salary:Employer 401k Match'))
            .toBe('Income:Salary:Employer 401k Match');
    });
});
