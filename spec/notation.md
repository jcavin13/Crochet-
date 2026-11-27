# Crochet notation (`.cro`) — grammar and semantics, v0.1

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
  `params` (id of a parameter set in `stitch_params.json`). Unknown keys are kept in `meta.extra`.
* **Round lines** start with a label and a colon:
  `Rnd N:` | `Round N:` | `R N:` | `Row N:` | `Foundation:` (alias `Start:`, `Setup:`; this is
  round 0 and may appear only first).
  * A range label `Rnds 6-10:` (also `Rnd 6-10:`, `Rows 2-5:`) repeats the instruction once per
    round in the range.
  * Round numbers must increase by one. A gap or duplicate is error `E_ROUND_NUMBER`.
  * A round's text continues until the next label, header or end of file, so long rounds may wrap
    across lines.
  * `Row` lines are worked flat: the work is turned between consecutive rows automatically
    (explicit `turn` is accepted and redundant). `Rnd` lines are worked in the round without
    turning unless an explicit `turn` appears.
* Keywords and stitch names are case-insensitive. `×` and `x` are interchangeable.
* Item separators inside a round: `,` `;` and `.` are equivalent. A trailing separator is allowed.

## 2. Grammar (EBNF)

```
pattern     = { header } , round , { round } ;
header      = KEY , ":" , TEXT , NEWLINE ;
round       = label , ":" , sequence , [ count ] ;
label       = ( "Rnd" | "Round" | "R" | "Row" | "Rnds" | "Rounds" | "Rows" ) , INT , [ "-" , INT ]
            | "Foundation" | "Start" | "Setup" ;

sequence    = item , { SEP , item } , [ SEP ] ;
SEP         = "," | ";" | "." ;
item        = repeat | group | stitch | chain | skip | join | ring | turn | fasten ;

repeat      = "*" , sequence , "*" , times                       (* *sc, inc* x6 *)
            | "*" , sequence , SEP , "rep" , "from" , "*" , reptail ;  (* *sc, inc; rep from * around *)
group       = ( "(" , sequence , ")" | "[" , sequence , "]" ) , [ target ] , [ times ] ;
times       = ( "x" | "×" ) , INT | INT , "times" | "around" | "across" | "to" , "end" ;
reptail     = INT , "more" , "times"        (* total = INT + 1 *)
            | INT , "times"                 (* total = INT, vintage usage "repeat from * 5 times" means 5 more: see 3.7 *)
            | "around" | "across" | "to" , "end" ;

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
fasten      = "fasten off" | "fo" | "finish off" ;

target      = ( "in" | "into" | "around" | "on" ) , [ loopmod , "of" ] , place ;
place       = "ring"
            | "same" , unit
            | "first" , unit
            | "top of" , ( "tch" | "turning ch" | "beg ch" [ "-" INT ] | "ch" "-" INT )
            | [ "next" ] , [ INT ] , unit
            | "each" , [ "of" ] , [ "next" , INT ] , unit , [ "around" | "across" | "to end" ]
            | ORDINAL , "ch from hook" ;
unit        = "st" | "sts" | "stitch" | "stitches"
            | stname                                  (* next dc, each sc around *)
            | [ "ch" , [ "-" , INT ] ] , ( "sp" | "sps" | "space" | "spaces" | "lp" | "loop" | "loops" )
            | "ch-sp" | "ch-sps"
            | "ch" | "chs" | "chain" | "chains" ;
loopmod     = "flo" | "blo" ;
count       = "(" , INT , [ countunit ] , { "," , INT , countunit } , ")" ;   (* last item of the round only *)
```

Articles (`the`, `a`, `an`) and the filler words `of`, `next` where optional are ignored.
`ORDINAL` is `2nd`, `3rd`, `4th`, … or `second`, `third`, `fourth`, `fifth`, `sixth`.

A parenthesised item at the very end of a round that matches `count` is a count annotation, never a group.

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

The next round keeps a **cursor** into the list, starting before the first entry (for a joined
round that is the stitch the join was made into; for a spiral it is the first stitch of the
previous round).

* `next st` moves the cursor to the next *stitch* target (silently passing over space targets) and
  consumes it. `next dc` moves to the next stitch target whose type is `dc` (passing over anything
  else).
* `next ch-sp` / `next sp` / `next loop` moves to the next *space* target (silently passing over
  stitch targets). `next ch-3 sp` additionally requires the space to have 3 chains: if the next
  space has a different length this is error `E_SPACE_LENGTH`.
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
  none left").
* `*…* around` / `across` / `to end` repeats the body until the stitch and space targets the body
  uses are exhausted. If the last repetition cannot complete: `E_REPEAT_UNEVEN`.
* At the end of a round, stitch targets that were never consumed or passed over produce warning
  `W_UNWORKED` (rounds only; in rows a trailing unworked turning chain is normal and is an info).

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
* `fasten off` ends the pattern; nothing may follow except comments.

### 3.6 Groups

`(…) in <place>` / `[…] in <place>`: every stitch inside the group that has no target of its own is
worked into that one place. Chains inside the group are ordinary chains (and form spaces).
A group followed by `xN` repeats. Groups may nest inside `*…*`; `*…*` does not nest in itself.

### 3.7 Repeats

`*A* xN` performs A exactly N times in total. `*A; rep from * N more times` performs A N+1 times.
For transcribing vintage patterns, where "repeat from * 5 times" is ambiguous, the notation defines
`rep from * N times` as N *total*; the transcriber resolves the ambiguity against the stitch count.

### 3.8 Count annotations

`(N)` or `(N sts)` asserts the number of stitch-counting nodes in the round (same definition as
stitch targets in 3.3). Other units:

* a stitch name (`16 dc`): stitch-counting nodes of that type, including a turning chain that counts as it;
* `ch-sps` / `sps` / `loops`: chain spaces created in the round; `ch-N sps`: only those of length N;
* `cl`, `puff`, `pc`, `picot`: nodes with that tag/type; `shells`, `v-sts`: groups of that kind.

A mismatch is error `E_COUNT_MISMATCH` with the expected and actual numbers. A unit the compiler
cannot check yields info `I_COUNT_UNVERIFIED`.

## 4. Diagnostics

Every diagnostic has `severity` (`error` | `warning` | `info`), `code`, `message`, and a source
span `{line, col, endLine, endCol}` (1-based, columns in UTF-16 code units, end exclusive), plus
`round` when applicable. Messages must say what was expected and what was found, in crocheter's
language, e.g.

```
Rnd 3, line 9 col 9: count mismatch — pattern says (18) but the round makes 17 stitches.
Rnd 4, line 10 col 24: repeat "*" opened here is never closed.
Rnd 5, line 11 col 18: "next ch-3 sp" — the next space is a ch-5 sp.
```

Codes: `E_SYNTAX`, `E_UNKNOWN_STITCH`, `E_UNCLOSED_REPEAT`, `E_UNCLOSED_GROUP`, `E_ROUND_NUMBER`,
`E_NO_TARGET`, `E_NO_SPACE`, `E_SPACE_LENGTH`, `E_NO_RING`, `E_NO_CHAIN`, `E_REPEAT_UNEVEN`,
`E_COUNT_MISMATCH`, `E_AFTER_FASTEN_OFF`, `W_UNWORKED`, `W_UNKNOWN_HEADER`, `I_COUNT_UNVERIFIED`,
`I_REDUNDANT_TURN`. The compiler recovers per round where it can so that several errors are
reported in one pass; a graph is emitted only if there are no errors.

## 5. Out of scope for v0.1

Colour changes and multiple yarns, working into rounds other than the previous one (spike
stitches, overlay crochet), joining motifs, short rows, Tunisian crochet, beads. The graph format
has room for these (`into` may point at any node) but the notation does not express them yet.
