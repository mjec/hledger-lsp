; Assignments fix real amounts, so a transaction built only from them can fail
; to balance. hledger: "The real postings' sum should be 0 but is: $-93".
2013/1/1
  a   $5
  b

2013/1/2
  a  = $6
  b  = $-99
