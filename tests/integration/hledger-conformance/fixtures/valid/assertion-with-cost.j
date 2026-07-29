; A balance assertion may carry a cost. hledger expands this costed assignment
; into conversion postings; what matters here is that the posting is recognised
; as an assignment rather than one missing an amount.
2022-01-01
	assets:eur  €10
	equity

2022-01-02
	assets:eur      = €1 @ $1
	assets:usd
