
```
2025-01-01 Transaction Title
    expenses:food              EUR -100.00 @ $2.00 = $ 400.00
    assets:cash                  $  200.00         = $2000.00
^^^^             ^^^^^^^^^^^^^^   ^ ^^^^^^     ^^^ ^^^^^^   ^^^^^   ^^^^^^^^
  | ^^^^^^^^^^^^^      |       ^^^|^ 
  |       |            |        | | 
Indent (default 4)     |        |Space bet
          |        Padding (to align decimal, Min 2)
          |                     |
     Account(Max X)             |
                                |
                            Commodity 
                              Before 
```

Ok, I want to change the way inlay hints are working as the alignment isn't working properly. We should largely ignore how inlay hints work currently. Inlay hints for are are somewhat complicated by the combination of the following:

1) we use whitespace to align the source files
2) that inlayhints take up space, so inserting them moves subsequent text on the line, which can mess with alignment
3) inlay hints occupy space, but do not themselves count as text, so if we try to align text after an inlayhint, particularly subsequent inlayhints, we need to be aware of inlayhints which will be added, rather than just the contents of the line itself
4) Generally we trim whitespace at the end of lines, but if we want to insert a inlayhint beyond the end of a line (in order to be aligned with content) we need either to pad the inlay hint itself, or insert whitespace sufficent to allow us to insert the inlay hint at the right spot and not trim it. If we pad the inlayhint itself then it has to be quite large, and vscode seems to shorten it to ..., so we have to insert the whitespace to allow for the inlay hint
5) We want the source files to be aligned even without the inlay hints being displayed (ie in another program, without the lsp)

I want to use inlay hints to display information which we don't have to, but can, explicitly state in the source file, and display it in as aligned a way as possible, so that if we were to inser the inlay hint explicitly, it would (mostly) not change when autoformatted (so you should look at the formatter.ts to see how information is formatted)

The 3 bits of information we (sometimes) don't have to state explictly are:

1) Amounts (these can be inferred, and are if they can be by the parser)
2) Cost conversions (these can be inferred, and are if they can be by the parser)
3) Balance assertions (these can be inferred, but are currently not inferred by the parser and are calculated by the inlayhint provider)

The general format of a posting lines is:
    account     amount  cost  balance  comment

I broadly want you to plan, and then reimplement (again, largely ignoring the current implementation, although you can look for specific details, ie as to how the balance assertions are calculated) the inlay hint feature. You should consider the facts above to add detail (or you can suggest alternatives if you think my reasoning is wrong, or you can think of better options) to the described aspects below:

1) Given the desire for the source files to be aligned even when viewed without the lsp, we should not insert inlay hints when there is content after where we would insert the inlay hint (othrewise for that content to stay aligned when veiwed with the lsp, we would have to remove whitespace, but for that content to stay aligned when viewed without the lsp we would have to leave the whitespace). This doesn't apply when the only content after the inlayhint is a comment as that doesn't need to be aligned

2) We should have settings for if we want to have inlayhints for amounts, costs, and balance assertions, depending on the combination of those enabled, and what information is explicitly provided on the posting line already we should, as necesary:

- insert whitespace as needed so that the inlay hints can be added in the correct position
- insert any needed and requested inlay hints nothing that subsequent inlay hints will need to be aware of the existence or not of previous inaly hints to corretly insert them at the correct position

There are some facts about the existance or need for inlayhints we can deduce logically:

1) If we need an amount inlay hint we will not need a cost conversion hint
