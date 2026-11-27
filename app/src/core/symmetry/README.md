# core/symmetry — rotational and mirror symmetry of a stitch graph

`analyzeSymmetry(graph) → SymmetryReport` (pure; no DOM). Used by the chart overlay, the editor's
symmetry panel and problems list, and the flatness assistant (which must not lower the order).

## Method

1. **One cyclic sequence of elements per round** (`sequence.ts`), in working order: every stitch
   (type, legs, loop modifier, cluster / puff / popcorn size), every chain space as one element
   (`ch 5` → `sp5`), every picot. Each stitch carries its anchors as *(round, element index,
   offset in a space)* plus the structural label of what it is worked into (`dc`, `sp5`, `ring`).
   Left out as artefacts of where a round starts: turning chains that do not count (a counting
   one *is* its stitch, standing on its base), slip stitches before the first stitch (travel),
   slip stitches into the round's own stitches (the join), the chains of a chain ring.
   A beginning cluster (`ch 3, 2-dc cl in same sp`) is read as the full cluster when that is
   what the round's other clusters are.
2. **Own order of a round**: the largest n dividing its length L such that shifting the sequence
   by L/n preserves every label and moves every anchor in a round below by one constant amount.
3. **Cumulative order** (the piece up to this round): the largest n that is an order of the
   piece below *and* for which the shift by L/n moves anchors by exactly L_q/n in their round q.
   Valid orders are closed under divisors and lcm, so only divisors of
   gcd(L, cumulative order below) are tested, largest first: O(L·d(L)) per round.
   A round can repeat 36 times and still leave the piece 12-fold (petal doily Rnd 11).
4. **Mirror**: element c−i must be the mirror image of element i (legs reversed, chain offsets
   mirrored) with anchors reflected about some centre in the round below; for the whole piece
   that centre must be one of the round below's valid centres (kept modulo L/n, the reflection
   classes). Whole piece → `D_n`, else `C_n`.
5. **Defects** ("almost symmetric"): for each round, the intended order is the piece's order
   below it (or the next round's own order). The round's tokens (label + target labels + how far
   each leg advances) are covered greedily with copies of its most frequent length-p word
   (p = round(L/n)); one or a few stray stretches (a substitution, an extra or missing item, a
   displaced increase) are reported with their node ids, stitch numbers and a diff in words
   ("one repeat has ch 4 where the others have ch 5"). The repaired labels are what the next
   round sees, so a typo is reported once, not again in the round above it.
6. **Frame** for drawing: n sector boundaries on the outermost round's elements (through a
   mirror axis when dihedral, so sector 0 is one repeat bounded by mirrors) and 2n mirror
   half-axes; positions are element indices (x.5 = between two elements).

## Choices and limits

* **Spirals**: each spiral round is read as a closed ring of its own stitches; the helical jog
  (each round starting one stitch on) is ignored — the stack of rings is what the eye sees, and a
  spiral sc circle with evenly spread (also staggered) increases is 6-fold.
* Stacked increases (`*sc, inc*`) are chiral — the inc's second stitch is on one side — so solid
  circles come out `C_n`, not `D_n`. That is what the graph says, and true of the fabric's twist.
* Structure only: colour, stitch height variation through tension, and geometry are ignored.
* Rows → `applicable: false`. Foundation-chain ovals are analysed as rings and come out low-order.
* Defect search tries the orders suggested by neighbouring rounds only, and accepts at most
  max(1, n/6) stray stretches, so a heavily mangled round is reported as simply low-order.
