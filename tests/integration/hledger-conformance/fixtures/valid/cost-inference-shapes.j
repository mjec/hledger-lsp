; Cost inference. The first transaction has one posting carrying the source
; commodity, so hledger states a total cost (€100 @@ $135). The second spreads
; the same 135/100 exchange as a unit rate over both € postings.
2011/01/01
    expenses:foreign currency       €100
    assets                         $-135

2011/01/02
    expenses:foreign currency        €99
    assets                         $-130
    expenses:foreign currency         €1
    assets                           $-5
