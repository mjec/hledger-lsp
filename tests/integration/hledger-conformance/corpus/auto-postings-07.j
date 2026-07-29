= ^expenses:foo
    budget:available   *-1
    assets:checking     *1

2018/10/17 * INITIAL
    budget:available   $100
    equity:opening

2018/10/17 * SOME EXPENSE
    expenses:foo                                 $50
    assets:checking

2018/10/17 * ASSERT
    budget:other
    budget:available                              =$0

# ** 9.
