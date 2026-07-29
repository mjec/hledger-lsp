import { isComment } from '../../src/utils/index';
import { parsePosting } from '../../src/parser/ast';
import { HledgerParser } from '../../src/parser/index';
import { TextDocument } from 'vscode-languageserver-textdocument';

function parse(text: string) {
    const doc = TextDocument.create('file:///t.journal', 'hledger', 1, text);
    return new HledgerParser().parse(doc);
}

describe('isComment', () => {
    // `#` only opens a comment at the start of a line. Indented, it is part of an
    // account name: hledger reads `  #a  1` as a posting to the account `#a`, and
    // even reads `  # looks like a comment` as an account of that name.
    it.each(['# top level', '#no space', '; top level', ';no space'])(
        'treats %s at the start of a line as a comment',
        (line) => {
            expect(isComment(line)).toBe(true);
        }
    );

    it.each(['  ; indented comment', '\t;tab indented', '  ;d   0'])(
        'treats an indented semicolon (%s) as a comment',
        (line) => {
            expect(isComment(line)).toBe(true);
        }
    );

    it.each(['  #a   1', '\t#a   1', '  # looks like a comment'])(
        'does not treat an indented hash (%s) as a comment',
        (line) => {
            expect(isComment(line)).toBe(false);
        }
    );
});

describe('posting status markers', () => {
    // hledger allows the marker to abut the account name, printing `*c  0` back as
    // `* c  0`. Only a leading marker counts — `b*` is an account name.
    it.each([
        ['  *c   0', 'cleared', 'c'],
        ['  !d   0', 'pending', 'd'],
        ['  * c   0', 'cleared', 'c'],
        ['  ! d   0', 'pending', 'd'],
    ])('reads %s as status %s on account %s', (line, status, account) => {
        const posting = parsePosting(line, '2024-01-01');
        expect(posting?.status).toBe(status);
        expect(posting?.account).toBe(account);
    });

    it('leaves an account that merely ends with an asterisk alone', () => {
        const posting = parsePosting('  b*  -1', '2024-01-01');
        expect(posting?.status).toBeUndefined();
        expect(posting?.account).toBe('b*');
        expect(posting?.amount?.quantity).toBe(-1);
    });

    it('reads an account that starts with a hash', () => {
        const posting = parsePosting('  #a   1', '2024-01-01');
        expect(posting?.account).toBe('#a');
        expect(posting?.amount?.quantity).toBe(1);
    });
});

describe('the corpus comments-04 journal', () => {
    // hledger finds three postings on accounts #a, b* and c, and the transaction
    // balances (1 - 1 + 0).
    const text = '2024-01-01\n'
        + '  #a   1  ; posting to #a account\n'
        + '  b*  -1  ; posting to b* account\n'
        + '  *c   0  ; posting to c account, with * status mark\n'
        + '  ;d   0  ; a comment line attached to the c posting above\n'
        + '; e    0  ; top level comment line, not part of the transaction\n'
        + '# f    0  ; top level comment line, not part of the transaction\n';

    it('finds exactly the three postings hledger finds', () => {
        const postings = parse(text).transactions[0].postings;

        expect(postings.map(p => p.account)).toEqual(['#a', 'b*', 'c']);
        expect(postings.map(p => p.amount?.quantity)).toEqual([1, -1, 0]);
    });

    it('marks the third posting cleared', () => {
        expect(parse(text).transactions[0].postings[2].status).toBe('cleared');
    });

    it('does not treat the top-level comment lines as postings', () => {
        expect(parse(text).transactions).toHaveLength(1);
        expect(parse(text).transactions[0].postings).toHaveLength(3);
    });
});
