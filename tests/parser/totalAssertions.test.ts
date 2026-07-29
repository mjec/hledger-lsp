import { parsePosting } from '../../src/parser/ast';

describe('total balance assertions (==)', () => {
    it('parses == as a total assertion', () => {
        const posting = parsePosting('  a         == $1', '2013-01-01');
        expect(posting?.assertion?.quantity).toBe(1);
        expect(posting?.assertion?.commodity).toBe('$');
        expect(posting?.assertionTotal).toBe(true);
    });

    it('parses == with no space before the amount', () => {
        const posting = parsePosting('  a         ==$1', '2013-01-01');
        expect(posting?.assertion?.quantity).toBe(1);
        expect(posting?.assertionTotal).toBe(true);
    });

    it('parses == alongside a written amount', () => {
        const posting = parsePosting('  a    1 A == 1 A', '2013-01-01');
        expect(posting?.amount?.quantity).toBe(1);
        expect(posting?.assertion?.quantity).toBe(1);
        expect(posting?.assertionTotal).toBe(true);
    });

    it('leaves a single = as a non-total assertion', () => {
        const posting = parsePosting('  a    $1  =$1', '2013-01-01');
        expect(posting?.assertion?.quantity).toBe(1);
        expect(posting?.assertionTotal).toBeFalsy();
    });

    it('parses a negative total assertion', () => {
        const posting = parsePosting('  b        ==-$1', '2013-01-01');
        expect(posting?.assertion?.quantity).toBe(-1);
        expect(posting?.assertionTotal).toBe(true);
    });

    // Subaccount-inclusive assertions are deliberately out of scope. They must
    // keep parsing to no assertion rather than being misread as a plain one.
    it.each(['  a         =* $1', '  a         ==* $1'])(
        'does not misparse the subaccount-inclusive form %s',
        (line) => {
            expect(parsePosting(line, '2013-01-01')?.assertion).toBeUndefined();
        }
    );
});
