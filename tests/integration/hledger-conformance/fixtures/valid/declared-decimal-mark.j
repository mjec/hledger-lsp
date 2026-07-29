; The commodity directive fixes "." as the decimal mark, so the comma in
; "1,000" must be read as a digit group separator: 1,000 == 1000.00 and the
; transaction balances.
commodity 1,000.00 EUR

2017/1/1 grouped
    a    1,000 EUR
    b   -1,000.00 EUR
