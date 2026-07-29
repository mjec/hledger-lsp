import { generateJournal, CONSTRUCTS } from './generator';

describe('the fuzz generator is deterministic', () => {
    it('produces the same journal for the same seed', () => {
        expect(generateJournal(42)).toBe(generateJournal(42));
    });

    it('produces different journals for different seeds', () => {
        const journals = new Set(Array.from({ length: 20 }, (_, i) => generateJournal(i)));

        expect(journals.size).toBeGreaterThan(15);
    });

    it('keeps journals small enough to read in a failure report', () => {
        for (let seed = 0; seed < 50; seed++) {
            expect(generateJournal(seed).split('\n').length).toBeLessThan(40);
        }
    });
});

describe('the fuzz generator exercises every construct it claims to', () => {
    // A construct whose branch silently stops firing would quietly shrink coverage
    // without any test failing, so each one has to appear across a fixed range of
    // seeds. CONSTRUCTS pairs each name with a predicate over the generated text.
    const journals = Array.from({ length: 400 }, (_, seed) => generateJournal(seed));

    it.each(CONSTRUCTS.map(c => [c.name, c] as const))('generates %s', (_name, construct) => {
        expect(journals.some(j => construct.appearsIn(j))).toBe(true);
    });
});

describe('generated journals are well formed', () => {
    const journals = Array.from({ length: 200 }, (_, seed) => generateJournal(seed));

    it('always starts with a directive or a date, never blank', () => {
        for (const journal of journals) {
            expect(journal.trimStart()).not.toBe('');
        }
    });

    it('never emits a posting line outside a transaction', () => {
        for (const journal of journals) {
            const lines = journal.split('\n');
            lines.forEach((line, i) => {
                if (!/^[ \t]+\S/.test(line)) return;
                // An indented line must be preceded by a transaction header, another
                // indented line, or a comment attached to one.
                const preceding = lines.slice(0, i).reverse().find(l => l.trim() !== '');
                expect(preceding).toBeDefined();
                expect(/^[ \t]/.test(preceding!) || /^[\d~=]/.test(preceding!)).toBe(true);
            });
        }
    });

    it('emits a Y directive before any year-less date', () => {
        for (const journal of journals) {
            const lines = journal.split('\n');
            let sawYear = false;
            for (const line of lines) {
                if (/^Y\s+\d{4}/.test(line)) sawYear = true;
                // A year-less transaction header starts with 1 or 2 digits.
                if (/^\d{1,2}[-/.]\d{1,2}(\s|$)/.test(line)) {
                    expect(sawYear).toBe(true);
                }
            }
        }
    });
});
