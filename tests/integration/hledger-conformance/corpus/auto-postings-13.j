= tag:tax20
  taxes  *0.2

2018/12/18
  a    EUR -10.00  ; :tax20:
  b    EUR 12.00

# ** 16. Transaction balancing sees auto postings ?
# $ hledger -f- print -x --auto
# 2018-12-18
#     a          EUR -10.00  ; :tax20:
#     taxes       EUR -2.00
#     b           EUR 12.00
#
# >=

# ** 16. No, transaction must be balanced both with and without auto postings.
