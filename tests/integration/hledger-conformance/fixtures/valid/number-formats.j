; Amounts may omit the leading digit before the decimal mark, and may be written
; in scientific notation. hledger 1.52.1 reads these as 0.01, 0.1, 105,
; 3.1415926 and 1000.
2017/1/1
    a   .01 EUR
    b

2017/1/2
    a   .1 EUR
    b  -.1 EUR

2018/1/1
   a  1.05e2
   b  31415926e-7
   c  1E+3
   d
