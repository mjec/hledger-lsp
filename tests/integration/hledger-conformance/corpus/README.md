# hledger test corpus

Journal snippets extracted from the [hledger](https://github.com/simonmichael/hledger)
project's own test suite (version 1.52.1), vendored here for differential
testing: `corpus.test.ts` runs the locally installed `hledger check` on each
file as ground truth and compares the LSP validator's verdict.

- Regenerate with: `node scripts/vendor-hledger-corpus.mjs /path/to/hledger-src`
- `manifest.json` records the source test file for each snippet.
- Do not edit the `.j` files by hand — they are generated.

**License note:** hledger is GPLv3; these test fixtures originate there and
remain under that license. They are used only for testing and are not part of
the published npm package (`files` in package.json ships `out/` only).
