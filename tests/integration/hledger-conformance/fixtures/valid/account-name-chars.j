; `#` only opens a comment at the start of a line — indented it belongs to an
; account name. A status marker may abut the account name (`*c`), while a trailing
; asterisk (`b*`) is just part of the name.
2024-01-01
  #a   1  ; posting to #a account
  b*  -1  ; posting to b* account
  *c   0  ; posting to c account, with * status mark
  ;d   0  ; a comment line attached to the c posting above
; e    0  ; top level comment line, not part of the transaction
# f    0  ; top level comment line, not part of the transaction
