; file comments, ignored
# file comment using a hash
* file comment using a star (org node)
 ; file comments need not
 # start in
 * column 0

; pre-transaction comment, ignored
2009/1/1 x ; transaction same line comment
      ; transaction new line comment
    a  1  ; posting 1 same line comment
    ; posting 1 new line comment
    a
      ; posting 2 new line comment
; file comment right after the transaction, ignored

; trailing file comment, ignored
