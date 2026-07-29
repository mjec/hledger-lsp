/**
 * Journal generator for differential fuzzing against hledger.
 *
 * Produces small journals that are valid *by construction*: every transaction
 * balances, and year-less dates always follow a `Y` directive so results never
 * depend on the clock. Invalid input is out of scope — see
 * docs/superpowers/specs/2026-07-29-differential-fuzzing-design.md.
 *
 * The variant tables below are the point of the exercise: they state what we claim
 * to support, across the dimensions where divergences have actually been found.
 *
 * Two constraints shape the design, both learned by watching hledger reject early
 * output:
 *
 * - Every commodity is declared with an explicit decimal mark. Without one, `1,000`
 *   is ambiguous and hledger reads it as 1.000 — so a grouped amount would silently
 *   change value and the transaction would not balance.
 * - A cost moves a posting's value into the cost commodity, so it cannot be
 *   sprinkled onto an otherwise balanced group. Costed transactions are their own
 *   shape, with the counter-amount computed exactly.
 */

/** Deterministic PRNG (mulberry32) so a failing seed always reproduces. */
export function makeRandom(seed: number) {
    let state = seed >>> 0;

    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    return {
        int: (n: number): number => Math.floor(next() * n),
        pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
        chance: (probability: number): boolean => next() < probability,
    };
}

type Random = ReturnType<typeof makeRandom>;

const DATE_SEPARATORS = ['-', '/', '.'] as const;
const STATUSES = ['', '* ', '! ', '*', '!'] as const;
const ACCOUNTS = [
    'assets:cash',
    'expenses:food',
    'income:salary',
    'assets:bank:current account',
    '#a',
    'b*',
] as const;

/** A commodity, with how it is declared and whether the symbol sits left of digits. */
interface Commodity {
    symbol: string;
    declaration: string;
    onLeft: boolean;
}

const COMMODITIES: readonly Commodity[] = [
    { symbol: '$', declaration: 'commodity $1,000.00', onLeft: true },
    { symbol: '€', declaration: 'commodity €1,000.00', onLeft: true },
    { symbol: 'EUR', declaration: 'commodity 1,000.00 EUR', onLeft: false },
    { symbol: 'USD', declaration: 'commodity 1,000.00 USD', onLeft: false },
    { symbol: '"WEGE3"', declaration: 'commodity 1,000.00 "WEGE3"', onLeft: false },
];

/**
 * Render a magnitude in one of the spellings hledger accepts, preserving the value
 * exactly so the transaction still balances.
 */
function writeNumber(random: Random, quantity: number): string {
    const magnitude = Math.abs(quantity);
    const sign = quantity < 0 ? '-' : '';

    if (Number.isInteger(magnitude)) {
        // Grouped forms are only unambiguous because every commodity is declared with
        // a decimal mark; see the file comment.
        if (magnitude >= 1000 && random.chance(0.35)) {
            const grouped = magnitude.toLocaleString('en-US');
            return sign + (random.chance(0.5) ? grouped : grouped.replace(/,/g, ' '));
        }
        if (magnitude !== 0 && magnitude % 100 === 0 && random.chance(0.25)) {
            return `${sign}${magnitude / 100}e2`;
        }
        return sign + String(magnitude);
    }

    const written = magnitude.toFixed(2);
    if (magnitude < 1 && random.chance(0.4)) return sign + written.replace(/^0/, '');
    return sign + written;
}

/** Attach a commodity symbol to a written number, varying placement and spacing. */
function writeAmount(random: Random, commodity: Commodity, quantity: number): string {
    const number = writeNumber(random, quantity);

    if (!commodity.onLeft) {
        return `${number} ${commodity.symbol}`;
    }

    const space = random.chance(0.3) ? ' ' : '';
    // A leading sign may sit either side of the symbol: -$1 or $-1.
    if (number.startsWith('-') && random.chance(0.5)) {
        return `-${commodity.symbol}${space}${number.slice(1)}`;
    }
    return `${commodity.symbol}${space}${number}`;
}

function writeDate(random: Random, year: number, month: number, day: number, yearless: boolean): string {
    const separator = random.pick(DATE_SEPARATORS);
    const pad = (n: number): string => (random.chance(0.5) ? String(n).padStart(2, '0') : String(n));
    const tail = `${pad(month)}${separator}${pad(day)}`;

    return yearless ? tail : `${year}${separator}${tail}`;
}

function writeHeader(random: Random, yearless: boolean): string {
    const status = random.pick(STATUSES);
    const description = random.pick(['groceries', 'pay', 'coffee | Blue Bottle', 'rent']);
    const date = writeDate(random, 2010 + random.int(12), 1 + random.int(12), 1 + random.int(28), yearless);

    return `${date} ${status}${description}`.replace(/\s+$/, '');
}

/** Wrap an account name in the delimiters of its balancing group. */
function writeAccount(account: string, group: 'real' | 'balanced'): string {
    return group === 'balanced' ? `[${account}]` : account;
}

/**
 * Postings of one balancing group in a single commodity, summing to zero. One may
 * omit its amount for hledger to infer.
 */
function writeGroup(random: Random, commodity: Commodity, group: 'real' | 'balanced'): string[] {
    const count = 2 + random.int(2);
    const quantities: number[] = [];

    for (let i = 0; i < count - 1; i++) {
        const magnitude = random.pick([1, 5, 20, 100, 1000, 2000, 0.5, 12.34]);
        quantities.push(random.chance(0.5) ? magnitude : -magnitude);
    }
    quantities.push(-quantities.reduce((sum, q) => sum + q, 0));

    const omitted = random.chance(0.4) ? quantities.length - 1 : -1;

    return quantities.map((quantity, i) => {
        const account = writeAccount(random.pick(ACCOUNTS), group);
        if (i === omitted) return `    ${account}`;

        let amount = writeAmount(random, commodity, quantity);
        // A lot annotation is documentation and does not affect balancing.
        if (random.chance(0.1)) amount += ' {2 USD} [2020-01-01] (lot A)';

        return `    ${account}  ${amount}`;
    });
}

/**
 * A conversion: one commodity exchanged for another at a stated cost. The
 * counter-amount is computed from the rate, so the transaction balances through the
 * cost rather than in a single commodity.
 */
function writeConversion(random: Random, from: Commodity, to: Commodity): string[] {
    const quantity = random.pick([1, 5, 20, 100]);
    const rate = random.pick([2, 1.5, 0.5]);
    const total = quantity * rate;

    const cost = random.chance(0.5)
        ? `@ ${writeAmount(random, to, rate)}`
        : `@@ ${writeAmount(random, to, total)}`;

    return [
        `    ${random.pick(ACCOUNTS)}  ${writeAmount(random, from, quantity)} ${cost}`,
        `    ${random.pick(ACCOUNTS)}  ${writeAmount(random, to, -total)}`,
    ];
}

/** One transaction: either a plain balanced entry or a conversion. */
function writeTransaction(random: Random, commodities: readonly Commodity[], yearless: boolean): string[] {
    const lines = [writeHeader(random, yearless)];

    if (commodities.length > 1 && random.chance(0.25)) {
        const [from, to] = commodities;
        lines.push(...writeConversion(random, from, to));
    } else {
        lines.push(...writeGroup(random, commodities[0], 'real'));
        // A balanced-virtual group balances independently of the real one.
        if (random.chance(0.15)) {
            lines.push(...writeGroup(random, commodities[0], 'balanced'));
        }
        // An unbalanced-virtual posting takes no part in balancing at all.
        if (random.chance(0.12)) {
            lines.push(`    (${random.pick(ACCOUNTS)})  ${writeAmount(random, commodities[0], random.pick([7, -7]))}`);
        }
    }

    if (random.chance(0.15)) lines.push('    ; a posting comment');

    return lines;
}

/** Generate a complete journal for a seed. */
export function generateJournal(seed: number): string {
    const random = makeRandom(seed);

    // Two distinct commodities, both declared with an explicit decimal mark so that
    // grouped amounts such as `1,000` cannot be misread.
    const first = random.pick(COMMODITIES);
    const second = random.pick(COMMODITIES.filter(c => c.symbol !== first.symbol));
    const commodities = [first, second];

    const lines: string[] = [first.declaration, second.declaration, ''];

    if (random.chance(0.25)) lines.push('; a top level comment');
    if (random.chance(0.25)) lines.push('# also a top level comment');

    // Year-less dates need a preceding Y, or hledger resolves them against the
    // current year and the fuzzer's results would depend on the clock.
    const yearless = random.chance(0.25);
    if (yearless) lines.push(`Y ${2010 + random.int(12)}`, '');

    const transactionCount = 1 + random.int(4);
    for (let i = 0; i < transactionCount; i++) {
        lines.push(...writeTransaction(random, commodities, yearless), '');
    }

    return lines.join('\n');
}

/**
 * Whether any posting states an account and no amount, leaving it for hledger to
 * infer. An amount is separated from the account by two or more spaces, so a posting
 * line with no such run is amount-less.
 */
function hasAmountlessPosting(journal: string): boolean {
    return journal.split('\n').some(line => {
        const match = line.match(/^ {4}(?![;([])(\S.*)$/);
        return match !== null && !/ {2}/.test(match[1]);
    });
}

/**
 * The constructs the generator is expected to produce, each with a predicate over
 * the generated text. A branch that silently stopped firing would shrink coverage
 * without any test failing, so `generator.test.ts` asserts every one appears.
 */
export const CONSTRUCTS: readonly { name: string; appearsIn: (journal: string) => boolean }[] = [
    { name: 'a dash-separated date', appearsIn: j => /^\d{4}-\d{1,2}-\d{1,2}/m.test(j) },
    { name: 'a slash-separated date', appearsIn: j => /^\d{4}\/\d{1,2}\/\d{1,2}/m.test(j) },
    { name: 'a dot-separated date', appearsIn: j => /^\d{4}\.\d{1,2}\.\d{1,2}/m.test(j) },
    { name: 'an unpadded date component', appearsIn: j => /^\d{4}[-/.]\d[-/.]/m.test(j) },
    { name: 'a year-less date with a Y directive', appearsIn: j => /^Y \d{4}/m.test(j) && /^\d{1,2}[-/.]\d{1,2} /m.test(j) },
    { name: 'a cleared status mark', appearsIn: j => /^\d\S*\s+\*/m.test(j) },
    { name: 'a pending status mark', appearsIn: j => /^\d\S*\s+!/m.test(j) },
    { name: 'an account containing a space', appearsIn: j => /bank:current account/.test(j) },
    { name: 'an account starting with #', appearsIn: j => /^ +#a/m.test(j) },
    { name: 'an account ending with *', appearsIn: j => /^ +b\*/m.test(j) },
    { name: 'a balanced virtual posting', appearsIn: j => /^ +\[/m.test(j) },
    { name: 'an unbalanced virtual posting', appearsIn: j => /^ +\(/m.test(j) },
    { name: 'a payee/note separator', appearsIn: j => j.includes(' | ') },
    { name: 'an omitted amount', appearsIn: hasAmountlessPosting },
    { name: 'a symbol on the left', appearsIn: j => /^ +\S.* [$€]-?\d/m.test(j) },
    { name: 'a symbol on the right', appearsIn: j => /\d (EUR|USD|"WEGE3")/.test(j) },
    { name: 'a negative sign before the symbol', appearsIn: j => /-[$€]\d/.test(j) },
    { name: 'a negative sign after the symbol', appearsIn: j => /[$€]-\d/.test(j) },
    { name: 'a leading-dot amount', appearsIn: j => /[\s$€]-?\.\d/.test(j) },
    { name: 'a scientific amount', appearsIn: j => /\d+e2\b/.test(j) },
    { name: 'a comma-grouped amount', appearsIn: j => /\d,\d{3}/.test(j) },
    { name: 'a space-grouped amount', appearsIn: j => /\d \d{3}(\D|$)/.test(j) },
    { name: 'a quoted commodity', appearsIn: j => j.includes('"WEGE3"') },
    { name: 'a unit cost', appearsIn: j => / @ /.test(j) },
    { name: 'a total cost', appearsIn: j => / @@ /.test(j) },
    { name: 'a lot annotation', appearsIn: j => /\{.*\} \[/.test(j) },
    { name: 'a commodity directive', appearsIn: j => /^commodity /m.test(j) },
    { name: 'a top-level semicolon comment', appearsIn: j => /^; /m.test(j) },
    { name: 'a top-level hash comment', appearsIn: j => /^# /m.test(j) },
    { name: 'an indented comment', appearsIn: j => /^ +; /m.test(j) },
];
