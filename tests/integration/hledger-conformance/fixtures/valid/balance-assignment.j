; A balance assignment states a balance and no amount; hledger infers the
; amount as asserted-minus-prior, and a later assignment sees amounts that
; were themselves auto-balanced.
2013/1/1
  a    $1.20
  b

2013/1/2
  a           =$1.3
  b

2013/1/3
  b   = $-3
  c
