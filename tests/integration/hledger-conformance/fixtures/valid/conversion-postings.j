; A pair of equity:conversion postings records both sides of an exchange, so each
; commodity balances on its own. An explicit cost alongside them documents the
; same exchange and must not be counted a second time.
2011/01/01
    assets                              $-135
    equity:conversion                   €-100
    equity:conversion                    $135
    expenses:foreign currency    €100 @@ $135

2023/05/17 * unit cost variant
    assets:bank              -84.01 USD @ 2.495 GEL
    equity:conversion         84.01 USD
    equity:conversion       -209.60 GEL
    assets:bank              209.60 GEL

2011/01/02 * no cost at all
    expenses:foreign currency       €100
    equity:conversion              €-100
    equity:conversion               $135
    assets                         $-135
