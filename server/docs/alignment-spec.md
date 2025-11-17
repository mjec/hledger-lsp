# Document-Wide Column Alignment Specification

## Overview

The formatter will align posting components across the entire document into consistent columns, making journal files more readable and easier to scan visually.

## Column Structure

Each posting line will be formatted with the following logical columns:

1. **Posting Indent** (4 spaces by default)
2. **Account Name** (left-aligned, variable width, maximum 42)
3. **Spacing** (minimum 2 spaces, padding added to algin the decimal in the amount after other padding)
4. **Commodity-Before Symbol** (right-aligned to amount, only for commodities that come before amounts, max width 4)
5. **Amount** (decimal-aligned - ALL amounts align here regardless of commodity position, max width 12)
6. **Commodity-After Symbol** (left-aligned after amount, only for commodities that come after amounts, max width 4)
7. **Spacing** (if balance assertion present, minimum 1 space)
8. **Equals Sign** (`=`)
9. **Spacing** (miniumum 1 space, padding added to align the decimal in the aseertion amount if enabled)
10. **Assertion Commodity-Before** (right-aligned to assertion amount, only for commodities that come before amounts, max width 4 )
11. **Assertion Amount** (decimal-aligned)
12. **Assertion Commodity-After** (left-aligned after assertion amount, only for commodities that come after amounts, max width 4)
13. **Comment** (if present, preserved with spacing)

**Key insight**: By separating commodity-before and commodity-after into distinct columns, all amount decimal points can align at the same column position, regardless of whether the commodity symbol appears before (`$45.67`) or after (`45.67 EUR`) the amount.

## Formatting Process
We should add padding, up to the maximums (which should be conifgurable via the options) to algin within a transaction each of the columns. We should have a target for the decimal position of the amount and the assertion amount, if we can add padding to the assigned space to meet that target we should, but we should not remove padding below the minimum.
