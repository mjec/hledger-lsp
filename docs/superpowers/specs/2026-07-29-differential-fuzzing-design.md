# Differential fuzzing against hledger

The vendored corpus has reached 92% agreement with one false positive left, and has
stopped producing new information. Three bugs fixed on 2026-07-29 were invisible to
it, all found by hand:

- `2024.01.05` — dot-separated dates rejected by the validator, so a valid journal
  was covered in errors.
- `1.5 x` — a dot year-less date was not recognised as a transaction header, so the
  entry and its postings vanished from the parse.
- `Y 2010` — the year directive was ignored, so year-less dates silently resolved to
  the wrong year.

Only the first would have been caught by comparing pass/fail verdicts. The other two
had hledger and the LSP both reporting "valid" while the parsed model was wrong.

## What it does

Generate a small valid journal from a seed, then compare three things against
hledger 1.52.1:

1. **Verdict** — `hledger check` succeeds, so the LSP must emit no error diagnostics.
2. **Shape** — the transaction count matches.
3. **Values** — per transaction: resolved date and description; per posting: account
   and amounts by commodity.

Values come from `hledger print -O json`, which reports exact quantities and fully
resolved dates, so there is no output formatting to re-parse. `runHledgerPrint` in
`hledgerRunner.ts` already provides this.

## Scope

Generated journals are **valid by construction**. Invalid input is out of scope:
error detection is already enumerated exhaustively by the corpus (20 known missed
errors), and an unparseable journal has no `print` output, so the values oracle
cannot run on it.

A generated journal that hledger *rejects* is a **generator** bug, not an LSP
finding, and is reported separately. Conflating the two would let a broken generator
masquerade as passing.

Journals are kept small — one to five transactions — so a failure is readable
without a shrinker.

## Grammar

The generator covers the dimensions where divergences have actually been found. The
grammar doubles as an explicit statement of what we claim to support; enumerating
date separators in it is exactly what would have caught the dot-date bug.

| Dimension | Variants |
|---|---|
| Date separator | `-`, `/`, `.` |
| Date padding | `2024-01-05`, `2024-1-5` |
| Year | explicit, or year-less against a preceding `Y` |
| Status | none, `*`, `!`, abutting or spaced |
| Account | plain, nested, containing a space, `#`-prefixed, `*`-suffixed |
| Posting kind | real, `(unbalanced)`, `[balanced]` |
| Amount | integer, decimal, leading dot, scientific, group separators |
| Commodity | symbol left, symbol right, spaced or not, quoted |
| Sign | `-1`, `$-1`, `-$1` |
| Cost | none, `@`, `@@` |
| Lot annotation | none, `{…}`, `[date]`, `(label)`, before or after the cost |
| Assertion | none, `=`, `==`, assignment (no amount) |
| Balancing | all amounts explicit, or exactly one omitted per group |

Every transaction is generated balanced: amounts within a balancing group are drawn
so they sum to zero, or one posting's amount is omitted for hledger to infer. A
single commodity per group keeps that tractable; a second commodity appears only via
an explicit cost.

Year-less dates are always generated with a preceding `Y`. Without one hledger
resolves them against the current year, which would make the fuzzer's results depend
on the clock.

## Known divergences

Some differences are deliberate. `known-divergences.ts` records each one with the
reason, and the comparator ignores matching cases:

- A costed balance assignment: hledger expands it into conversion postings, which
  the one-`Amount`-per-posting model cannot represent.
- Multi-commodity inference: hledger can infer two amounts for one posting.

The list is a committed file, so adding to it is a visible decision in review rather
than a silent suppression.

## Running it

One code path, two entry points:

- `npx jest --selectProjects conformance` runs a **fixed seed** with a small count as
  an ordinary test. Deterministic, so CI cannot flake, and it guards the covered
  constructs against regression.
- `npm run fuzz` re-invokes the same test with `FUZZ_SEED` and `FUZZ_COUNT`
  overrides for long exploratory runs.

It lives in the conformance project because it needs the hledger binary and must stay
out of `npm test`, which has to remain fast. It skips gracefully when hledger is
absent, like the rest of that suite.

A divergence found by a long run is minimised by hand and promoted to a permanent
fixture in `fixtures/`, the way corpus findings have been. The fuzzer finds bugs; the
fixtures stop them coming back.

## Testing the fuzzer

The generator and comparator are themselves tested, in the default project without
hledger:

- The generator is deterministic: the same seed produces the same journal.
- Different seeds produce different journals.
- Every construct in the table above appears within a fixed number of seeds, so a
  silently-dead branch cannot go unnoticed.
- The comparator reports a divergence when handed a deliberately wrong model, and
  none when handed a matching one.
