# Feature Ideas

Potential features for the hledger language server, organized by estimated impact and effort.

## High Impact

### 1. Payee-based transaction templates

When the user types a payee name on a transaction header and triggers completion, suggest the full posting structure based on the most recent transaction with that payee. For example, after typing:

```
2024-03-08 Groceries
```

The server would offer to fill in the postings based on the last transaction with "Groceries":

```
2024-03-08 Groceries
    expenses:food                          $45.00
    assets:checking
```

**Implementation notes:**
- `transactionAnalyzer.ts` already performs pattern analysis on past transactions — this would extend it to produce snippet-style completions with tab stops for amounts.
- Could use LSP snippet syntax (`${1:amount}`) so the user tabs through editable fields.
- Should offer the most recent match first, with alternatives if the payee has multiple patterns.
- Trigger: completion on a transaction header line after the payee name, or on the first empty line after a header.

### 2. Account balance on hover

When hovering over an account name (in postings, directives, or anywhere it appears), show aggregate balance information drawn from the workspace-parsed data:

```
assets:checking
  Balance: $1,234.56
  Transactions: 47
  Last used: 2024-03-01
  Declared: yes (line 5, accounts.journal)
```

**Implementation notes:**
- `runningBalanceCalculator.ts` already computes per-line running balances — extracting the final balance per account from workspace data is straightforward.
- `hover.ts` already handles account hover with basic info; this adds computed fields.
- Multi-commodity accounts would show one line per commodity.
- Could also show monthly average or recent trend if data is available.

### 3. Date completion

When the cursor is at the start of an empty line (where a transaction date would go), offer date completions:

- Today's date
- Yesterday's date
- Start of current month
- Dates from recent transactions (last 5-10 unique dates)
- Next occurrence of recurring periodic transactions

**Implementation notes:**
- Small addition to `completion.ts` — detect when cursor is at position 0 on a blank line or on a partial date string.
- Format dates according to the file's existing convention (YYYY-MM-DD vs YYYY/MM/DD).
- Could also trigger after typing a partial date like `2024-03` to suggest days.

### 4. Duplicate transaction detection

A validation rule that flags transactions with the same date, payee, and posting amounts as potential duplicates. Common scenario: importing bank transactions that overlap with manually entered ones.

```
2024-03-01 Groceries
    expenses:food    $45.00
    assets:checking

2024-03-01 Groceries        ; Warning: Possible duplicate of transaction on line 1
    expenses:food    $45.00
    assets:checking
```

**Implementation notes:**
- New module in `features/validation/` following the established pattern.
- Key comparison: date + payee + sorted posting amounts (ignore comments, tags, formatting differences).
- Should be configurable: enable/disable, and possibly a tolerance window (e.g., flag duplicates within N days).
- Severity should default to `information` or `hint` since legitimate duplicate transactions exist.

## Medium Impact

### 5. Transaction sorting

A code action or command to sort transactions by date within a file or selection. Useful when manually adding transactions out of order, or after merging entries from multiple sources.

**Implementation notes:**
- The parser already provides `transaction.line` and the line ranges can be computed (each transaction block runs until the next header or blank line).
- Would need to preserve blank lines between transactions and keep non-transaction content (directives, comments at top of file) in place.
- Could be offered as both a code action on the full document and as a command (`hledger.sortTransactions`).
- Should handle the case where transactions are interleaved with periodic transactions or auto postings (only sort regular transactions, leave others in place).

### 6. Document highlight

LSP `textDocument/documentHighlight` highlights all occurrences of a symbol in the current file when the cursor is on it. Unlike find references, this is lightweight (no results panel, no cross-file search) and provides immediate visual feedback.

**Implementation notes:**
- Most of the matching logic already exists in `findReferences.ts` — the `findAccountReferences`, `findPayeeReferences`, etc. methods return ranges within a single file.
- `getItemAtCursor` already identifies what's under the cursor.
- Register `connection.onDocumentHighlight` in `featureRegistry.ts`.
- Return `DocumentHighlight[]` with `DocumentHighlightKind.Read` for usages and `DocumentHighlightKind.Write` for declarations/directives.

### 7. Period expression completion

In `~` (periodic transaction) headers, offer completion for period expressions. hledger supports a well-defined set:

- Simple intervals: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`
- Compound: `every 2 weeks`, `every 3 months`, `every day`
- With anchoring: `monthly from 2024-01`, `every 2 weeks from 2024-01-01`
- Specific days: `every 1st day of month`, `every 15th`

**Implementation notes:**
- Detect when cursor is on a line starting with `~` and after the tilde.
- Provide a static list of common period expressions as completion items.
- Could also parse existing periodic transactions in the file to suggest consistent patterns.

### 8. Price-aware hover

When hovering over an amount that has a cost notation (`@ $1.50` or `@@ $150`), or when `P` (price) directives exist for that commodity, show the converted value:

```
10 AAPL @ $150.00
  → Total cost: $1,500.00
  → Latest price (P directive, 2024-03-01): $155.00
  → Current value at latest price: $1,550.00
```

**Implementation notes:**
- `priceDirectives` are already parsed and available in `ParsedDocument`.
- `hover.ts` already handles amount hover — this adds price lookups.
- For cost notation, the conversion is straightforward (already parsed in `posting.cost`).
- For P directive lookups, find the most recent price directive for the commodity pair.
- Multi-step conversions (A→B→C) are out of scope initially.
