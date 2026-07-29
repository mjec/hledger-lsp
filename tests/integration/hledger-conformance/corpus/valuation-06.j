
D 1000.00 H                ; declare a default commodity named H

P 2015/08/15 EEEE  41.66   ; default commodity H is used for these market prices
P 2015/08/15 FFFF  74.62
P 2015/08/15 GGGG  32.39

2015/08/15
    a  2.4120 EEEE @@ 100  ; default commodity H is used for these transaction prices
    a  0.3350 FFFF @@ 25
    a  0.7718 GGGG @@ 25
    b                      ; implicit balancing amount is in the cost commodity, H
