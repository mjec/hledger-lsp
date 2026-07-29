; some market prices
P 2019-01-01 B   10 A
P 2019-01-01 C    2 B
P 2019-01-01 A  100 D
P 2019-01-01 E    3 D

; a transaction with both amounts in B
2019-06-01
    a  1 B
    b

; tests follow. This comment directive makes this file readable
; by hledger, as well as shelltest; useful when troubleshooting.
comment

# ** 1. normal unvalued output
