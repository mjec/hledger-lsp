import { parseDate, validateDateFormat } from '../../../src/features/validation/dates';
import { Transaction } from '../../../src/types';

function tx(date: string): Transaction {
    return { date, description: 'x', payee: 'x', note: '', postings: [], line: 0 };
}

describe('parseDate', () => {
    // hledger accepts single-digit month/day (2011/5/5). These must parse to the
    // same UTC instant as their zero-padded equivalents, independently of the
    // machine's timezone — `new Date("2011-5-5")` parses as *local* time, which
    // shifts the UTC calendar day whenever the local offset is non-zero.
    it.each([
        ['2011/5/5', '2011-05-05T00:00:00.000Z'],
        ['2011-05-05', '2011-05-05T00:00:00.000Z'],
        ['2018/10/7', '2018-10-07T00:00:00.000Z'],
        ['2020/10/7', '2020-10-07T00:00:00.000Z'],
        ['2013/1/1', '2013-01-01T00:00:00.000Z'],
        ['2024/12/31', '2024-12-31T00:00:00.000Z'],
    ])('parses %s as UTC midnight %s', (input, expected) => {
        expect(parseDate(input)?.toISOString()).toBe(expected);
    });

    it('returns null for a date that does not exist in the calendar', () => {
        expect(parseDate('2001/2/29')).toBeNull();
    });

    it('returns null for a non-date string', () => {
        expect(parseDate('not-a-date')).toBeNull();
    });
});

describe('validateDateFormat', () => {
    // Regression: these were flagged "date does not exist in calendar" because
    // the UTC/local mismatch shifted the day by one (corpus assertions-13.j,
    // auto-postings-03.j, auto-postings-12.j).
    it.each(['2011/5/5', '2018/10/7', '2020/10/7', '2013/1/1', '2011-05-05', '2015/9/6'])(
        'accepts valid non-zero-padded date %s',
        (date) => {
            expect(validateDateFormat(tx(date), [date])).toEqual([]);
        }
    );

    it('still rejects Feb 29 in a non-leap year', () => {
        const diags = validateDateFormat(tx('2001/2/29'), ['2001/2/29']);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('date does not exist in calendar');
    });

    it('still rejects Apr 31', () => {
        const diags = validateDateFormat(tx('2024/4/31'), ['2024/4/31']);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('date does not exist in calendar');
    });

    it('accepts Feb 29 in a leap year', () => {
        expect(validateDateFormat(tx('2024/2/29'), ['2024/2/29'])).toEqual([]);
    });

    it('still rejects an out-of-range month', () => {
        const diags = validateDateFormat(tx('2010/31/12'), ['2010/31/12']);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('month must be 1-12');
    });

    it('still rejects an out-of-range day', () => {
        const diags = validateDateFormat(tx('2010/12/32'), ['2010/12/32']);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('day must be 1-31');
    });
});

describe('dot-separated dates', () => {
    // hledger accepts `.` alongside `-` and `/`, with 1- or 2-digit month and day:
    // `2024.01.05`, `2024.1.5`. These parsed into transactions but then failed
    // validation, so a perfectly valid journal was covered in "Invalid date format"
    // errors — a false positive the corpus never covered.
    it.each([
        ['2024.01.05', '2024-01-05T00:00:00.000Z'],
        ['2024.1.5', '2024-01-05T00:00:00.000Z'],
        ['2011.5.5', '2011-05-05T00:00:00.000Z'],
    ])('parses %s as %s', (input, expected) => {
        expect(parseDate(input)?.toISOString()).toBe(expected);
    });

    it.each(['2024.01.05', '2024.1.5', '2024.2.29'])('accepts %s', (date) => {
        expect(validateDateFormat(tx(date), [date])).toEqual([]);
    });

    it('still rejects a non-existent dot date', () => {
        const diags = validateDateFormat(tx('2001.2.29'), ['2001.2.29']);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('date does not exist in calendar');
    });

    // hledger requires one separator throughout: `2024-01/05` is rejected.
    it.each(['2024-01/05', '2024.01-05', '2024/01.05'])('rejects mixed separators in %s', (date) => {
        const diags = validateDateFormat(tx(date), [date]);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('Invalid date format');
    });
});
