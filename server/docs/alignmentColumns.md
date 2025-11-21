```
[ indent ][account name(Left)][ decimalAlignmenPadding ][ doubleSpace (Left)] [ commodityBefore (Right) ][negative ? (fixedWidth)][commodityAfter (left)][]
[ ]

 
2024-01-01 Grocery Shopping
    |expenses:food       |                   |   | | 25000.50 |Apples |@@ |£|-|100.0 |   |= | |1000.00 |Apples| ;Comment
    |expenses:household  |                   |EUR| |123000.75 |       |@  | | |  1   |USD|= |£|0       |      |
    |assets:checking     |                   |  $|-|140009.25 |       |   | | |      |   |= |£|0       |      |
    |assets:a really really long account name which $||100.25 |       |   | | |      |   |  | |        |      |

[indent]                 [padding column]    [commodityBeforeAmount][commodityBeforeCost]
    [account]                                    [negativeSignAmont]
                                                    [amount]  [commodityAfterAmount]  [cost]


 
2024-01-01 Grocery Shopping
    |expenses:food       |                   |   | | 25000.50 |Apples |@@ |£-100.0 |= | 100.00 Apples ;Comment
    |expenses:household  |                   |EUR| | -1200.75 |       |@  |1 USD   |= |£-10 ;Comment
    |assets:checking     |                   |  $|-|140009.25 |       |   |        |= |  £0           |                               



2024-01-01 Grocery Shopping
    |expenses:food       |                   |   | | 25000.50 |Apples |@@ |£-100.0 |= | | |1000.00 |Apples| ;Comment
    |expenses:household  |                   |EUR| |123000.75 |       |@  |1 USD   |= |£|-|  10    |      | ;Comment
    |assets:checking     |                   |  $|-|140009.25 |       |   |        |= |£| |   0    |      |                               
```
