; hledger writes lot annotations after the cost, as `AMOUNT @ COST {LOT} [DATE]
; (LABEL)`. The cash posting auto-balances to $-1000: 10 AAPL at $100 each.
2026-01-01 buy
    assets:investment    10 AAPL @ $100 {$100} [2026-01-01] (lot A)
    assets:cash

2026-01-02 annotation before the cost
    assets:investment    5 AAPL {$100} @ $100
    assets:cash
