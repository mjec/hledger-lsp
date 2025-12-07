
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

    it('should extract account if separated by only 1 space before amount (loose parsing)', () => {
        // Our regex is slightly loose and allows 1 space before digits, which is useful for robustness
        expect(extractAccountFromPosting('    Expenses:Food 10 USD')).toBe('Expenses:Food');
    });
});
