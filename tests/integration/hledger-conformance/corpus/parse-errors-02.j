2009/1/1
  a   1

# ** 2. When read from stdin with no reader prefix, the journal reader is used
# (before 1.17, all readers were tried and the timedot reader would succeed),
# giving an unbalanced error in this case.
