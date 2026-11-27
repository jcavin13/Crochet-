# Crochet notation (`.cro`) — grammar and semantics, v0.1 (+ border extension, 3.9)

This is the text notation the editor, corpus and fixtures use. It is deliberately close to how
patterns are written in English (US terms by default) but is strict enough to compile
deterministically to the stitch graph (`pattern.schema.json`).

The reference implementation is the TypeScript parser/compiler in `app/src/core/notation` and
`app/src/core/graph`. When the implementation and this document disagree, that is a bug in one
of them: fix it and record the decision in `docs/decisions.md`.

## 1. File layout

```
# comment (to end of line)
title: Flat sc circle
terms: US                  # US (default) | UK
yarn: worsted-4
hook: 5.0mm
source: original
license: CC0-1.0

Rnd 1: mr, 6 sc in ring. (6)
Rnd 2: inc x6. (12)
Rnd 3: *sc, inc* x6. (18)
```

* **Header lines** `key: value` come before the first round line. Keys are free-form identifiers;
  known keys: `title`, `terms`, `yarn`, `hook`, `source`, `license`, `author`, `year`, `notes`,
  `params` (id of a parameter set in `stitch_params.json`), `colors` (a colour plan as text, e.g.
  `colors: A Oatmeal #e9dfcc; B Sage #a3b18a` — kept in `meta.colors`; colour changes themselves
  are not part of the graph, section 5). Unknown keys are kept in `meta.extra`.
* **Round lines** start with a label and a colon:
  `Rnd N:` | `Round N:` | `R N:` | `Row N:` | `Foundation:` (alias `Start:`, `Setup:`; this is
  round 0 and may appear only first).
  * A range label `Rnds 6-10:` (also `Rnd 6-10:`, `Rows 2-5:`) repeats the instruction once per
    round in the range.
  * An **odd/even range** `Rows 2-120 (even):` / `Rows 3-121 (odd):` repeats the instruction on the
    rows of that parity only. Consecutive odd/even labels of the same kind form one block whose rows
    are worked in number order (2, 3, 4, …), each from its own label — the usual way to write a
    two-row repeat (moss stitch, granny stripe, shells). Both ends of such a range must have its
    parity, and together the block's ranges must cover every number once (`E_ROUND_NUMBER`).
  * Round numbers must increase by one. A gap or duplicate is error `E_ROUND_NUMBER`.
  * A round's text continues until the next label, header or end of file, so long rounds may wrap
    across lines.
  * `Row` lines are worked flat: the work is turned between consecutive rows automatically
    (explicit `turn` is accepted and redundant). `Rnd` lines are worked in the round without
    turning unless an explicit `turn` appears: a `turn` before the round's first stitch — first,
    or after its starting chain, before anything is worked into the round below (`ch 1, turn, sc in each st
    around`) — turns that round; a `turn` after a stitch (`…, join, turn.`) turns the next round.
* Keywords and stitch names are case-insensitive. `×` and `x` are interchangeable.
* Item separators inside a round: `,` `;` and `.` are equivalent. A trailing separator is allowed.

## 2. Grammar (EBNF)

```
pattern     = { header } , round , { round } ;
header      = KEY , ":" , TEXT , NEWLINE ;
round       = label , ":" , sequence , [ count ] , [ SEP ] , [ fasten , [ SEP ] ] ;
label       = ( "Rnd" | "Round" | "R" | "Row" | "Rnds" | "Rounds" | "Rows" ) , INT , [ "-" , INT , [ "(" , ( "odd" | "even" ) , ")" ] ]
            | "Foundation" | "Start" | "Setup" ;

sequence    = item , { SEP , item } , [ SEP ] ;
SEP         = "," | ";" | "." ;
item        = repeat | group | stitch | chain | skip | join | ring | turn | fasten | otherside ;
otherside   = "working" , ( "along" | "across" | "in" | "on" | "into" ) ,
              ( [ "opposite" | "other" | "back" | "bottom" ] , "side" | "unused" , "loops" ) ,
              "of" , [ "foundation" ] , ( "ch" | "chain" ) ;                    (* 3.9 *)

repeat      = "*" , sequence , "*" , times                       (* *sc, inc* x6 *)
            | "*" , sequence , SEP , "rep" , "from" , "*" , reptail ;  (* *sc, inc; rep from * around *)
group       = ( "(" , sequence , ")" | "[" , sequence , "]" ) , [ target ] , [ times ] ;
times       = ( "x" | "×" ) , INT | INT , "times" | extent ;
extent      = "around" | "across" | "to" , "end" | [ "across" ] , "to" , [ "next" ] , "corner" ;   (* corner: 3.9 *)
reptail     = INT , "more" , "times"        (* total = INT + 1 *)
            | INT , "times"                 (* total = INT (not INT more): see 3.7 *)
            | extent ;

stitch      = [ INT ] , stname , [ loopmod ] , [ target ]        (* 2 dc in next st *)
            | stname , INT                                        (* sc 5  ==  5 sc *)
            | stname , ( "x" | "×" ) , INT ;                      (* inc x6 == 6 inc *)
chain       = "ch" , INT , [ countsas ] ;
countsas    = "(" , "counts" , "as" , [ "first" ] , stname , [ ( "," | "+" | "and" ) , "ch" , INT ] , ")"
            | "(" , "does" , "not" , "count" , "as" , [ "a" ] , ( "st" | "stitch" ) , ")" ;
skip        = ( "sk" | "skip" | "miss" ) , ( INT , [ unit ] | [ "next" ] , [ INT ] , unit ) ;
join        = "join" , [ "with" , "sl st" ] , [ target ]
            | ( "join" | "sl st in first ch" ) , ( "to form" | "into" | "to make" ) , [ "a" ] , "ring"
            | "form ring" ;
ring        = "mr" | "magic ring" | "magic circle" ;
turn        = "turn" ;
fasten      = ( "fasten off" | "fo" | "finish off" ) , [ "and weave in" , [ "yarn" ] , "ends" ] ;

target      = ( "in" | "into" | "around" | "on" ) , [ loopmod , "of" ] , place ;
place       = "ring"
            | "same" , unit
            | "first" , unit
            | "top of" , ( "tch" | "turning ch" | "beg ch" [ "-" INT ] | "ch" "-" INT )
            | [ "next" ] , [ INT ] , unit
            | "each" , [ "of" ] , [ "next" , INT ] , unit , [ extent ]
            | ORDINAL , "ch from hook" ;
unit        = "st" | "sts" | "stitch" | "stitches"
            | stname                                  (* next dc, each sc around *)
            | [ "ch" , [ "-" , INT ] ] , ( "sp" | "sps" | "space" | "spaces" | "lp" | "loop" | "loops" )
            | "ch-sp" | "ch-sps"
            | "ch" | "chs" | "chain" | "chains"
            | "row" , [ "-" ] , ( "end" | "ends" ) | ( "end" | "ends" ) , "of" , ( "row" | "rows" )   (* 3.9 *)
            | "corner" | "corners" ;                                                              (* 3.9 *)
loopmod     = "flo" | "blo" ;
count       = "(" , INT , [ countunit ] , { "," , INT , countunit } , ")" ;   (* last item of the round; only fasten may follow *)
```

Articles (`the`, `a`, `an`) and the filler words `of`, `next` where optional are ignored.
`ORDINAL` is `2nd`, `3rd`, `4th`, … or `second`, `third`, `fourth`, `fifth`, `sixth`.

A parenthesised item at the very end of a round that matches `count` is a count annotation, never a group.
"The very end" ignores a trailing `fasten off`: `Rnd 9: inc x6. (12) Fasten off.` is a count followed by
fasten off. A bare count such as `(6)` anywhere else in a round is `E_SYNTAX` ("a count annotation
… must come last in the round"), not an empty group.

A line that says only `Fasten off.` (or `Finish off.`, `FO.`, optionally "… and weave in ends") ends
the last round, wherever it stands after the first round — on its own line, after the count, or
after a header line such as `notes:` that follows the rounds. Before the first round it is
`E_SYNTAX`. A round with no items (`Rnd 2: .` or `Rnd 2: (12)`) is `E_SYNTAX` ("the round has no
instructions").

## 3. Semantics

### 3.1 Stitch names

The machine-readable vocabulary is `stitches.json`. Canonical (US) names and what they compile to:

| Notation | Compiles to |
|---|---|
| `ch N` | N chain nodes (`type: "ch"`), no anchors |
| `sl st` (`slst`, `ss`) | `slst` node, 1 anchor |
| `sc`, `hdc`, `dc`, `tr`, `dtr` | one node of that type, 1 anchor |
| `inc` (also `sc inc`), `hdc inc`, `dc inc`, `tr inc` | 2 stitches into the same target; nodes share `group {kind:"inc"}` |
| `dec`, `invdec` | `sc2tog` |
| `<st>Ntog` e.g. `sc2tog`, `dc3tog`, `tr2tog` | ONE node of the base type with N anchors (one per leg). Default target: the next N stitches. With an explicit single place (`dc3tog in next st`) all N legs go into that one place. |
| `cl`, `N-dc cl`, `N-tr cl` (cluster), `bobble` (= `5-dc cl`) | `dcNtog` into a single place (default N=3, default place: next st); node has `tag: "cluster"` |
| `puff`, `N-loop puff` | one `puff` node, 1 anchor, `loops: N` (default 3) |
| `pc`, `popcorn`, `N-dc pc` | one `popcorn` node, 1 anchor, `legs: N` (default 5) |
| `picot`, `ch-N picot`, `picot N` | one `picot` node, no anchor, `chains: N` (default 3). It sits on the previous stitch. |
| `shell`, `N-dc shell` | N dc (default 5) into one place; `group {kind:"shell"}` |
| `v-st`, `vst`, `v` | `(dc, ch 1, dc)` in one place; `group {kind:"v"}` |
| `fpdc`, `bpdc`, `fpsc`, `fphdc`, `fptr`, `bp…` | base node with `loop: "fp"` / `"bp"` |
| `sc flo`, `flo sc`, `sc in blo of next st` | base node with `loop: "flo"` / `"blo"` |

**UK terms.** With `terms: UK`, names are translated before anything else:
`dc→sc`, `htr→hdc`, `tr→dc`, `dtr→tr`, `trtr`/`ttr→dtr`, `ss→sl st`, `miss→sk`, and likewise inside
compound names (`tr3tog`→`dc3tog`, `fptr`→`fpdc`, `3-tr cl`→`3-dc cl`). The graph always stores US types.

### 3.2 Counts and targets

* `N st` with **no target** means one stitch in each of the next N stitches: `5 sc` = `sc 5` =
  `sc in next 5 sts`.
* `N st in <single place>` means N stitches into that one place: `2 sc in next st`, `15 dc in ring`,
  `3 dc in same sp`.
* `st in next N sts` / `st in each of next N sts` means N stitches, one per target.
* `N st in each st around` means N stitches into every remaining target of that unit.
* `ch N` never has a target. `sk N` consumes N stitch targets without working them.

### 3.3 The target list and the cursor

When a round is finished it exposes an ordered **target list** for the next round. Each entry is

* a **stitch target**: every node of the round that *counts as a stitch* — i.e. every node except
  plain chains, slip stitches and picots — plus the top chain of a turning chain that
  `(counts as …)` a stitch; or
* a **space target**: every chain space created in the round (see 3.4).

Entries are in working order. For a `Row`, or after `turn`, the next round walks the list in
reverse.

The next round keeps a **cursor** into the list. It starts just before the first entry, and that
first entry is, for a joined round, the stitch the join was made into, and for a spiral, the first
stitch of the previous round. So at the start of a joined round `next st` / `next dc` may be the
join stitch itself (4a).

* `next st` moves the cursor to the next *stitch* target (silently passing over space targets) and
  consumes it. `next dc` moves to the next stitch target whose type is `dc` (passing over anything
  else).
* `next ch-sp` / `next sp` / `next loop` moves to the next *space* target (silently passing over
  stitch targets). `next ch-3 sp` moves to the next space *of 3 chains*, passing over spaces of
  other lengths; only when no ch-3 sp is left but some other space is, it is error
  `E_SPACE_LENGTH` ("the next space is a ch-5 sp").
* `same st` / `same sp` is the target most recently used in this round (does not move the cursor).
  At the start of a joined round, before any target has been used, `same st` is the first stitch
  target (the one the join landed in) and it becomes consumed.
* `first st` is the first stitch-counting node of the **current** round (used by joins).
  `top of beg ch`, `top of tch`, `top of ch-3` are aliases of `first st` in a `Rnd` and of
  `next st` in a `Row`.
* `ring` is the most recently created ring space (magic ring or chain ring). Does not move the cursor.
* `Nth ch from hook` addresses the chain run made most recently (in this round or the previous
  one), counting back from the hook. After it, `next ch` / `each ch across` continue along that
  chain away from the hook. Chains skipped at the hook end are a turning chain.
* Running out of targets is error `E_NO_TARGET` ("Rnd 4 needs a stitch to work into but Rnd 3 has
  none left"; "has none" / "made none" when the previous round never had that kind of target).
* `*…* around` / `across` / `to end` repeats the body until the stitch and space targets the body
  uses are exhausted. If the last repetition cannot complete: `E_REPEAT_UNEVEN`.
* At the end of a round, targets after the cursor that were never consumed or passed over produce
  warning `W_UNWORKED`: every stitch target, and every space target whose chain length is one this
  round worked into (a round that works into ch-3 sps and leaves the last ch-3 sps unworked is
  warned; ch-1 sps that a round of `sc in next st` passes over everywhere are not). This applies to
  rows too; when all that is left in a row is a counting turning chain it is info
  `I_UNWORKED_TCH` instead. A closing chain arc may span a few trailing targets (4a).

### 3.4 Chain spaces, rings and turning chains

Spaces are first-class graph entities (`graph.spaces`).

* **Chain space.** Every maximal run of consecutive `ch` nodes inside a round forms a space
  (`kind: "chsp"`) whose `chains` are those nodes — *except* turning chains (below) and chains
  closed into a ring. A run of length 1 is a `ch-1 sp`.
* **Turning chain.** A chain run at the very start of a round, before any stitch other than slip
  stitches has been made in that round, is a turning chain: its nodes get `role: "tch"` and it
  does not form a space.
  * `ch 3 (counts as dc)`: the last chain gets `countsAs: "dc"`. It then counts as a stitch (in
    counts, as a target for the next round and as `first st`). It stands on a **base**: the target
    most recently used in this round, or — if none has been used — the first stitch target, which
    is thereby consumed. If the round has no targets yet used and a ring was created in this
    round (`mr, ch 3 (counts as dc), 11 dc in ring`), the base is the ring. The base is stored as
    the `into` of the top chain.
  * `ch 5 (counts as dc, ch 2)`: the first h chains (h = `tch` height of the stitch in
    `stitches.json`: sc 1, hdc 2, dc 3, tr 4, dtr 5) are the turning chain as above; the remaining
    chains form an ordinary chain space.
  * Without a counts-as note, the turning chain does not count and consumes nothing.
* **Rings.** `mr` creates a ring space with no chains (`kind: "ring"`). `ch N, join to form ring`
  adds a slip stitch into the first of those chains and creates a ring space whose `chains` are the
  N chains. Stitches worked `in ring` have a space anchor.
* **Individual chains** can be addressed with the `ch` unit (`sc in next ch`, `sc in each ch
  across`, `sc in 2nd ch from hook`); the anchor is then the chain node, not the space.

### 3.5 Joins and round structure

* `join` = `sl st in first st`. A round that ends with a join is a *joined* round
  (`rounds[i].joined = true`); otherwise it is a spiral round or a row.
* The join slip stitch is not a stitch target and is not counted.
* `fasten off` ends the pattern. It may stand inside the last round, after its count annotation,
  or on a line of its own (section 2). After it, only comments and header lines may follow; a
  further round is `E_AFTER_FASTEN_OFF` (reported once, with no cascade of count errors).

### 3.6 Groups

`(…) in <place>` / `[…] in <place>`: every stitch inside the group that has no target of its own is
worked into that one place. Chains inside the group are ordinary chains (and form spaces).
A group followed by `xN` repeats. Groups may nest inside `*…*`; `*…*` does not nest in itself.

### 3.7 Repeats

`*A* xN` performs A exactly N times in total. `*A; rep from * N more times` (also `N times more`)
performs A N+1 times. `rep from * N times` performs A N times **in total**. Vintage patterns often
mean "5 more" by "repeat from * 5 times"; the notation does not guess — the transcriber resolves the
ambiguity against the stitch count and writes `N more times` where that is meant.

### 3.8 Count annotations

`(N)` or `(N sts)` asserts the number of stitch-counting nodes in the round (same definition as
stitch targets in 3.3). Other units:

* a stitch name (`16 dc`): stitch-counting nodes of that type, including a turning chain that counts as it;
* `ch-sps` / `sps` / `loops`: chain spaces created in the round; `ch-N sps`: only those of length N;
* `cl`, `puff`, `pc`, `picot`: nodes with that tag/type; `shells`, `v-sts`: groups of that kind.

A mismatch is error `E_COUNT_MISMATCH` with the expected and actual numbers. A unit the compiler
cannot check yields info `I_COUNT_UNVERIFIED`.

### 3.9 Borders: rounds worked around rows (extension to v0.1)

A border is worked in rounds around a piece made in rows: across the top, down a side into the
**row ends**, along the bottom into the unused loops of the **foundation chain**, up the other
side, with extra stitches at the four **corners**.

**The perimeter.** A `Rnd` that follows a `Row` does not see the last row's target list: it sees
the perimeter of the piece, in working order from where the yarn is at the end of the last row
(the round is `turned`, as a next row would be; an explicit `turn` before its first stitch is
`I_REDUNDANT_TURN`):

1. **top** — the last row's targets (stitches and chain spaces), turned;
2. **first side** — one row end per row, from the last row down to the first row of the row block;
3. **bottom** — the foundation chain's unused loops, one per chain under the first row (from the
   first to the last chain the first row worked into, skipped chains included, hook-end turning
   chains excluded), from the first side's end towards the other;
4. **second side** — one row end per row, from the first row up to the last.

The first and last stitch of the top and of the bottom are the four **corners**.

**Units and places.**

* `row end` (`row ends`, `row-end`, `end of row`, `ends of rows`) addresses the next row-end target:
  `sc in next row end`, `2 sc in each row end across`, `sc in next 5 row ends`, `sk next row end`.
* `ch` and `st` both address the foundation-chain targets along the bottom
  (`sc in each ch across to corner`).
* `corner` addresses the next corner: `3 sc in corner` (= `in next corner`), `(sc, ch 2, sc) in corner`.
* `across` in a round with corners runs **to the end of the current side**, i.e. up to (not
  including) the next corner; `across to corner`, `to corner` and `to next corner` say the same
  explicitly. A corner the cursor already stands on belongs to the side (it is worked as an
  ordinary stitch). `*…* across to corner` repeats until the side is used up.
* `around` and `to end` still mean the rest of the whole list.

**Later border rounds** are ordinary rounds on the round before, but keep their corners: each
corner group of the previous round — the stitches worked into one corner — marks a corner again:
the chain space inside the group if it has one (`(sc, ch 2, sc)` → the ch-2 sp), else its middle
stitch (`3 sc` → the 2nd; for an even group the later of the two middle ones). So
`*sc in each st across to corner, 3 sc in corner* x4, sc in each st across` works round after round.

**Rules and diagnostics** (crocheter's language, with positions):

* A corner is never passed over: a unit that would have to cross a corner to find its target is
  `E_NO_TARGET` ("needs a row end to work into but the top edge has none left before the corner —
  work the corner first").
* Passing over a row end or a foundation chain with another unit is `E_NO_TARGET` ("the next target
  on the first side (row ends) is a row end — write "sc in next row end"").
* Going to a stitch corner leaves the stitches before it unworked: `W_UNWORKED` ("2 stitches of
  Row 20 are passed over without being worked (on the top edge)"). A corner that is a chain space
  is reached like any space, passing over stitches silently.
* `corner` when none is left: `E_NO_TARGET` ("needs a corner but no corner is left in Rnd 2 — all 4
  corners have been worked (or passed) already"); `to corner` in a round without corners:
  `E_NO_TARGET`.
* `W_UNWORKED` at the end of a border round counts stitches, row ends and foundation chains, by side.
* `E_REPEAT_UNEVEN`, `E_COUNT_MISMATCH` as usual (per round; the border's per-side counts follow
  from the instructions).

**Graph.** Anchors stay `{node}` | `{space}`; a node anchor may carry an optional `part`
(`pattern.schema.json`): `{node: e, part: "side"}` is the row end of the row whose edge stitch is
`e` (the first or last stitch-counting node of that row, a counting turning chain included);
`{node: c, part: "base"}` is the unused bottom loops of chain `c`. The validator allows such
anchors any number of rounds back (`G_ANCHOR_ROUND` is not raised) and checks that a `side` anchor
is a stitch and a `base` anchor a chain (`G_ANCHOR_PART`). Corners are not stored: they are derived
from the structure (the same rule as above), so tools can recompute them (`borderLists` in
`app/src/core/graph/targets.ts`; `describeNode` says "sc in corner (2 of 3)", "sc in row end of
Row 12", "sc in unused loop of foundation ch").

**Working round both sides of a chain.** `working along the other side of the chain` (also
`working along opposite side of foundation ch`, `working in unused loops of foundation ch`) turns
the chain cursor round the end of the chain worked from the hook in this round: it then runs back
along the unused loops of the chains already worked, not into the last one again. Example (an
oval / rectangle in the round):
`Foundation: ch 11.` `Rnd 1: sc in 2nd ch from hook, sc in next 8 chs, 5 sc in next ch, working
along the other side of the chain, sc in next 8 chs, 4 sc in next ch, join. (26)`. Those stitches
anchor `{node: c, part: "base"}`. In a border round (which already includes the bottom) the phrase
is accepted and changes nothing.

Not covered by the extension: starting a border by going down a side first ("do not turn"),
"sc evenly along the side" without a count, `to last st`, and corners inside pieces worked in the
round from the centre (a granny square's corners are addressed as `next ch-2 sp`).

## 4. Diagnostics

Every diagnostic has `severity` (`error` | `warning` | `info`), `code`, `message`, and a source
span `{line, col, endLine, endCol}` (1-based, columns in UTF-16 code units, end exclusive), plus
`round` when applicable. Messages must say what was expected and what was found, in crocheter's
language, e.g.

```
Rnd 3, line 9 col 9: count mismatch — pattern says (18) but the round makes 17 stitches.
Rnd 4, line 10 col 24: repeat "*" opened here is never closed.
Rnd 5, line 11 col 18: "next ch-3 sp" — the next space is a ch-5 sp (no ch-3 sp is left in Rnd 4).
```

Codes: `E_SYNTAX`, `E_UNKNOWN_STITCH`, `E_UNCLOSED_REPEAT`, `E_UNCLOSED_GROUP`, `E_ROUND_NUMBER`,
`E_NO_TARGET`, `E_NO_SPACE`, `E_SPACE_LENGTH`, `E_NO_RING`, `E_NO_CHAIN`, `E_REPEAT_UNEVEN`,
`E_COUNT_MISMATCH`, `E_AFTER_FASTEN_OFF`, `W_UNWORKED`, `W_UNKNOWN_HEADER`, `I_COUNT_UNVERIFIED`,
`I_REDUNDANT_TURN`, `I_UNWORKED_TCH`. A pattern that grows past 50 000 nodes (e.g. a mistyped
`ch 200000`) is `E_SYNTAX`: the largest crochet object on record has about 25 500 stitches, and a
graph that size would freeze the chart and the 3D view. The compiler recovers per round where it can so that several errors are
reported in one pass; a graph is emitted only if there are no errors.

## 4a. Clarifications adopted during implementation

These refine the sections above (full list: `app/src/core/notation/SPEC_NOTES.md`).

* `next ch-N sp` searches forward past spaces of other lengths; `E_SPACE_LENGTH` fires only when no
  space of that length remains (3.3).
* **Closing-arc rule.** A chain arc immediately before the join (or the end of the round) may span
  the trailing targets of the previous round without `W_UNWORKED` — but only as many as one arc
  plausibly covers. Let u₁ < … < u_m be the positions in the target list (stitches and spaces) that
  this round consumed or skipped, n the length of the list. The arc spans the wrap-around stretch
  n − u_m + u₁; it is accepted when that is at most max(3, the widest step u_{i+1} − u_i used inside
  the round), i.e. no longer than the round's own widest gap between anchors (and always up to two
  unworked entries, the usual "…ch 4, join" finish over a stitch and a ch-1 sp). A round that works
  two of eight loops and joins is warned ("6 stitches and 6 chain spaces of Rnd 1 are left
  unworked … more than the closing chain arc can span").
* `W_UNWORKED` applies to rows too; a trailing unworked turning chain in a row is info `I_UNWORKED_TCH`.
* The cursor of a joined round starts just before the stitch the join landed in, so `next st` /
  `next dc` at the start of the round may be that stitch (3.3).
* Foundation chains and hook-addressed chains are plain chains (neither turning chain nor space);
  chains skipped at the hook end get `role: "tch"`.
* `ch n (counts as S, ch m)` makes n−m turning chains.
* Round numbers may restart at 1 when a pattern switches between `Row` and `Rnd`.
* Accepted phrasings beyond the grammar: `same st as join`, `3 ch`, `(counts as dc throughout)`,
  `rep from * N times more`.

## 5. Out of scope for v0.1

Colour changes and multiple yarns (a `colors:` header and `#` comments can describe a colour plan,
but the graph does not record it), working into rounds other than the previous one (spike
stitches, overlay crochet), joining motifs, short rows, Tunisian crochet, beads. The graph format
has room for these (`into` may point at any node) but the notation does not express them yet.
