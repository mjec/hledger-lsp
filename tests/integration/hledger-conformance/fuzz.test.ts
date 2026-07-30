/**
 * Differential fuzzing against the hledger CLI.
 *
 * Generates small journals that are valid by construction, then compares hledger's
 * reading of each against the LSP's — verdict, transaction count, resolved dates and
 * posting amounts. See
 * docs/superpowers/specs/2026-07-29-differential-fuzzing-design.md.
 *
 * The default run uses a fixed seed and a small count so it is deterministic and
 * cannot make CI flaky. For a long exploratory run:
 *
 *   npm run fuzz                       # 2000 journals from seed 1
 *   FUZZ_SEED=500 FUZZ_COUNT=20000 npm run fuzz
 *
 * A divergence it turns up should be minimised by hand and promoted to a fixture in
 * fixtures/, so it can never come back.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateJournal } from '../../fuzz/generator';
import { findDivergences, findFormattingDivergences, formatJournal } from '../../fuzz/compare';
import { isHledgerAvailable, runHledgerCheck, runHledgerPrint } from './hledgerRunner';

const SEED = Number(process.env.FUZZ_SEED ?? 1);
const COUNT = Number(process.env.FUZZ_COUNT ?? 150);

const describeFuzz = isHledgerAvailable() ? describe : describe.skip;

interface Finding {
    seed: number;
    journal: string;
    divergences: string[];
}

/** A generated journal hledger rejects is a generator bug, not an LSP finding. */
interface GeneratorFault {
    seed: number;
    journal: string;
    error: string;
}

describeFuzz('differential fuzzing', () => {
    it(`agrees with hledger on ${COUNT} generated journals from seed ${SEED}`, () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-lsp-fuzz-'));
        const findings: Finding[] = [];
        const generatorFaults: GeneratorFault[] = [];

        try {
            for (let i = 0; i < COUNT; i++) {
                const seed = SEED + i;
                const journal = generateJournal(seed);
                const filePath = path.join(workDir, `seed-${seed}.journal`);
                fs.writeFileSync(filePath, journal);

                // Journals are generated valid, so a rejection means the generator is
                // wrong. Reported separately: a broken generator must not be able to
                // masquerade as a passing run.
                const verdict = runHledgerCheck(filePath);
                if (!verdict.success) {
                    generatorFaults.push({
                        seed,
                        journal,
                        error: verdict.errors[0]?.message?.split('\n')[0] ?? 'unknown',
                    });
                    continue;
                }

                const printed = runHledgerPrint(filePath);
                const divergences = findDivergences(journal, filePath, printed);

                // Formatting must not change what the journal means. `--format -o` and
                // format-on-save overwrite the file, so a formatter that rewrites
                // content corrupts the user's data.
                const formattedPath = path.join(workDir, `seed-${seed}-formatted.journal`);
                fs.writeFileSync(formattedPath, formatJournal(journal, filePath));
                const formattedVerdict = runHledgerCheck(formattedPath);
                if (!formattedVerdict.success) {
                    divergences.push(
                        `formatting produced a journal hledger rejects: `
                        + `${formattedVerdict.errors[0]?.message?.split('\n')[0] ?? 'unknown'}`
                    );
                } else {
                    divergences.push(...findFormattingDivergences(printed, runHledgerPrint(formattedPath)));
                }

                if (divergences.length > 0) {
                    findings.push({ seed, journal, divergences });
                }
            }
        } finally {
            fs.rmSync(workDir, { recursive: true, force: true });
        }

        if (generatorFaults.length > 0) {
            const report = generatorFaults
                .slice(0, 3)
                .map(f => `seed ${f.seed}: ${f.error}\n${f.journal}`)
                .join('\n\n');
            throw new Error(
                `The generator produced ${generatorFaults.length}/${COUNT} journals hledger rejects. `
                + `Generated journals are meant to be valid by construction, so this is a generator `
                + `bug, not an LSP finding.\n\n${report}`
            );
        }

        if (findings.length > 0) {
            const report = findings
                .slice(0, 3)
                .map(f => `── seed ${f.seed}\n${f.divergences.map(d => `   • ${d}`).join('\n')}\n\n${f.journal}`)
                .join('\n\n');
            throw new Error(
                `${findings.length}/${COUNT} generated journals are read differently from hledger.\n`
                + `Reproduce one with: FUZZ_SEED=<seed> FUZZ_COUNT=1 npm run fuzz\n\n${report}`
            );
        }

        expect(findings).toEqual([]);
    }, 600_000);
});
