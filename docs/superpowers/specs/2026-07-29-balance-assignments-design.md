# Balance assignments

Corpus divergence cluster 2. Implements hledger's *balance assignment*: a posting
that gives a balance with no amount (`a  = $1.30`), where the amount is inferred
as `asserted balance − prior balance of that account`.

Ground truth is hledger 1.52.1, verified empirically for every rule below.

## Scope

In scope:

- Amount inference for `=` assignments, including the cascade through
  auto-balanced postings.
- Parsing `==` as a *total* balance assertion, and its total semantics (the named
  commodity equals the asserted amount **and** every other commodity of that
  account is zero).
- Per-balancing-group auto-balancing, which correct inference requires.
- The error hledger raises for an assignment combined with a custom posting date.

Deferred (later clusters):

- `=*` / `==*` subaccount-inclusive assertions. They currently parse to *no*
  assertion at all; that behaviour is unchanged.
- Assignment with a cost (`= €1 @ $1`, corpus `assertions-28.j`). Also parses to
  no assertion today; unchanged.

## Verified semantics

1. **Inference** — `amount = asserted − prior balance` for that account and the
   asserted commodity.

2. **Cascade through auto-balancing.** An assignment sees amounts that were
   themselves auto-balanced in earlier transactions:

   ```
   2013/1/1   a $1 / b          → b auto-balances to $-1
   2013/1/2   b = $-3           → infers $-2
   ```

3. **Assignments resolve before auto-balancing, in posting order.** An assignment
   sees explicit amounts from earlier postings of the same transaction
   (`a $10` then `a = $30` → `$20`), but not amounts that are still unknown
   because they await auto-balancing (corpus `assertions-11.j`: `(b) = 14$`
   infers `14$` even though an earlier `b` posting exists, because that posting's
   amount is not yet known).

4. **Account balance ignores virtual markers.** Real, `[balanced]`, and
   `(unbalanced)` postings all feed the same account balance. In
   `assertions-11.j`, `b`'s balance after transaction 1 is
   `-4$ + 14$ - 1$ = 9$`, mixing all three kinds.

5. **Balancing groups are separate.** Real postings balance among themselves and
   `[balanced virtual]` postings balance among themselves, each group getting its
   own auto-balanced posting: `a 1 / b / [e] 10 / [f]` yields `b = -1` and
   `[f] = -10`. `(unbalanced)` postings never participate.

6. **A transaction of only assignments can be unbalanced**, and hledger reports
   it — so inference must not silently suppress balance checking:

   ```
   2013/1/2   a = $6 / b = $-99   → "sum should be 0 but is: $-93"
   ```

7. **`==` is a total assertion.** `a 0 A == 1 A` fails when the account also
   holds `1 B`, reporting across all commodities. As an assignment (`a == $8`)
   it infers exactly like `=`.

8. **Assignment + custom posting date is an error**: "Balance assignments and
   custom posting dates may not be combined."

## Design

### Representation

Assignment-inferred amounts are written to `posting.amount` with
`inferred: true` — the same mechanism the parser already uses for auto-balanced
postings (`inferAmountsForPostings`), so every existing consumer (running
balances, hover, formatter, missing-amounts) works unchanged. A separate
`posting.isBalanceAssignment` marker records provenance, because two consumers
need to distinguish an assignment from an auto-balance:

- `balance.ts` — an assignment fixes a real amount, so the transaction must still
  be balance-checked (rule 6). An auto-balanced posting makes the transaction
  balance by construction, so it must not.
- the posting-date check (rule 8).

### Where inference runs

A pre-pass over the merged workspace document, before any validator and
independent of the enabled-checks settings (individual validations can be turned
off, so inference cannot live inside one of them). It needs the merged document
because prior balances may come from included files.

New module `src/features/validation/balanceAssignments.ts`:

- `resolveBalanceAssignments(transactions)` — mutates postings, setting inferred
  amounts and markers.
- `validateBalanceAssignmentDates(...)` — the rule 8 diagnostic.

### Algorithm

Transactions in journal order; per transaction:

1. **Assignments, in posting order.** For each posting with an assertion and no
   written amount: `inferred = asserted − (running balance + amounts of earlier
   postings in this transaction on the same account and commodity)`. Set
   `amount` (with `inferred: true`) and `isBalanceAssignment`.
2. **Auto-balance per group.** Partition remaining amount-less postings into the
   real group and the balanced-virtual group; a group with exactly one amount-less
   posting gets the negated sum of its group.
3. **Fold** every posting's amount into the running balances, once.

Ordering reuses the cross-file ordering already implemented in `assertions.ts`,
extracted to a shared helper so the pre-pass and the assertion check cannot
drift. The pre-pass orders whole *transactions* rather than individual postings:
posting-date reordering only matters for assertions, and rule 8 forbids combining
a posting date with an assignment.

### Testing

Unit tests per rule above, plus conformance fixtures run against the real
hledger CLI. Corpus expectation: the six false positives
`assertions-08/-10/-11/-13/-15.j` (not `-28`, which needs deferred
assignment-with-cost) plus the `assertions-12.j` missed error, and
`virtual-postings-05.j` should fall out of the per-group auto-balancing.

`assertions-10.j`'s last transaction needs *cost* inference on top of assignment
inference (`c = 50 B` becomes `50 B @@ 50 A`), which belongs to cluster 3. If
resolving its assignments exposes a new imbalance report, that is a known
follow-on, not a regression to fix here.
