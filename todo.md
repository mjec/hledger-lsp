# hledger-lsp TODO

## Parser Conformance Gaps

Known divergences from hledger CLI behavior, tracked via `test.failing()` in
`tests/integration/hledger-conformance/conformance.test.ts`.

Run conformance tests: `npx jest --selectProjects conformance`

### Critical — Incorrect data

- [ ] **Thousands separator parsing** — `$18,000,000` parsed as `18`, `$1,000`
      as `1`
  - Fix `detectNumberFormat()` in `src/parser/ast.ts`
  - 2 failing tests + Cody.journal balance mismatch ($153k vs $18M)

- [ ] **Short (yearless) dates** — `1/1`, `12/25` produce 0 transactions
  - Fix `parseDate()` in `src/parser/ast.ts` and `isTransactionHeader()` in
    `src/utils/index.ts`
  - 3 failing tests; `borrowing.journal` entirely unparseable

### High — Content incorrectly parsed

- [ ] **`comment`/`end comment` block directive** — content inside blocks parsed
      as real data
  - Add block-comment state to parse loop in `src/parser/index.ts`
  - 1 failing test

- [ ] **Dot-separated dates** — `2024.01.01` not recognized
  - Add `.` to date separator regex in `parseDate()` and `isTransactionHeader()`
  - 1 failing test

### Medium — Incorrect metadata

- [ ] **Virtual postings `()` and `[]`** — delimiters kept in account name,
      balance errors
  - Strip delimiters in `parsePosting()`, add `virtual` field to `Posting` type
  - 2 failing tests (+2 from unicode.journal)

- [ ] **Posting-level status `*`/`!`** — markers included in account name
  - Strip prefix in `parsePosting()`, add status field to `Posting` type
  - 1 failing test

- [ ] **Strict `balanced` check** — no option to require explicit `@` cost
      notation
  - Add `requireExplicitCosts` validation setting
  - 1 failing test

### Low — Missing semantic features (no `test.failing()` yet)

- [ ] `alias` directive — recognized but not applied
- [ ] `apply account` / `end apply account` — not recognized
- [ ] `D` (default commodity) — not recognized
- [ ] `Y` (default year) — not recognized
- [ ] `P` (market price) — recognized but not stored
- [ ] `decimal-mark` — recognized but not applied
- [ ] `=` (auto posting rules) — recognized, no semantic effect
- [ ] `~` (periodic transactions) — header detected but unused, accounts not
      collected
