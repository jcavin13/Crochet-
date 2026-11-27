# Spec notes — decisions where `spec/notation.md` v0.1 is ambiguous or silent

notation.md says disagreements belong in `docs/decisions.md`. This list is where they wait until the
spec owner moves them there. Each item says what the implementation does and why.

## Semantics

1. **`next ch-N sp` skips spaces of other lengths.** 3.3 says a different-length next space is
   `E_SPACE_LENGTH`. Read that way, `simple_doily` Rnd 6 fails: `next ch-2 sp` has a ch-1 sp in
   between each time. Crocheters read it as "the next ch-2 sp". So the cursor searches forward for a
   space of length N, passing over other spaces. `E_SPACE_LENGTH` ("the next space is a ch-5 sp")
   is raised only when no ch-N sp is left but some other space is.
2. **Chain arcs span trailing stitches.** If the last thing before the closing join (or the end of
   the round) is a chain run, any stitch targets after the cursor count as passed over, so there is
   no `W_UNWORKED`. This is the usual lace finish, e.g. `simple_doily` Rnd 6: "…ch 4, join" leaves a
   dc and a ch-1 sp of Rnd 5 under the last arc.
3. **`W_UNWORKED` applies to rows too.** 3.3 says "(rounds only; in rows a trailing unworked
   turning chain is normal and is an info)". The implementation warns in rows as well. The one
   exception: if everything left unworked is counting turning-chain tops, it emits the info
   `I_UNWORKED_TCH`. That code is not in section 4's list.
4. **The cursor starts before the join stitch, and `next dc` matches a counting tch.** This
   follows 3.3 literally: the first entry is the stitch the join went into, and `next dc` matches a
   turning chain that `countsAs: "dc"`, which is consistent with 3.8 counts. One consequence: in
   `simple_doily` Rnd 4, `sl st in next dc` goes into the top of Rnd 3's ch-3, where the join is,
   not into the dc after it, which is where a crocheter would put it. Counts are unaffected and the
   difference is one slip stitch's position. **Suggest the spec clarify** whether `next` at the
   start of a joined round means the join stitch or the one after it.
5. **Foundation-round chains are "plain".** They are not a turning chain and not a chain space. A
   chain run addressed one chain at a time (`Nth ch from hook`, `next ch`, `each ch across`) never
   forms a space. With `Nth ch from hook`, the N−1 chains skipped at the hook end get
   `role: "tch"`. That also happens after the fact when the chain belongs to the previous round
   (`Foundation: ch 11` then `Row 1: sc in 2nd ch from hook`).
6. **Stitches without a target while working along a chain.** If a chain cursor is active and no
   stitch targets remain (Row 1 off a foundation chain), an untargeted stitch goes into the next
   chain. So `sc in 2nd ch from hook, 9 sc` works.
7. **`next ch` / `each ch` with no chain cursor.** These start on the previous round's unaddressed
   foundation chain, counting from the hook end. Otherwise they enter the next chain space of the
   previous round and walk its chains, reversed if the round is turned.
8. **Counts-as split.** `ch n (counts as S, ch m)` gives n−m turning chains, the last of which
   counts as S, followed by an m-chain space. 3.4 uses the `tch` height from stitches.json for the
   first part. The two agree whenever the note is consistent (tiny: `ch 4 (counts as dc, ch 1)` =
   3+1). When it is not (`ch 4 (counts as dc, ch 2)`), the chains the pattern names win. If n−m < 1
   the result is `E_SYNTAX`.
9. **`declaredCount`.** It comes from `(N)` / `(N sts)`. A typed list (`(4 dc, 4 ch-1 sps)`)
   sets it only when the stitch parts are a complete total: their sum equals the round's stitch
   count, and there are no shell, v-st or unknown units. Otherwise the field is omitted.
10. **Count units.** A typed stitch unit such as `16 dc` counts nodes of that type, including tog
    nodes and counting turning chains, but excluding cluster-tagged nodes, which `cl` counts.
    `ch` and `sl st` units are not stitch-counting, so they give `I_COUNT_UNVERIFIED`, as do
    unknown units (`6 incs`).
11. **Round numbering.** The first numbered round must be 1, possibly after a Foundation round. A
    switch between Row and Rnd may restart at 1, for an edging after rows. `R N:` means a Rnd.
    Labels are normalised to `Rnd N` / `Row N` / `Foundation`.
12. **Headers after rounds** (any `key: value` line that is not a label) are accepted as headers.
    1 says "until the next label, header or end of file", but the EBNF puts headers first.
13. **`joined`.** A round is joined when its last node is a sl st into a stitch-counting node of
    the same round. That covers `join`, `sl st in first st` and `sl st in top of ch-3`.
14. **`turn`.** As the first item of a Rnd, it turns that round. Anywhere else, it turns the next
    round. In a Row it is always `I_REDUNDANT_TURN` and has no further effect.
15. **`*…* around` termination.** The repeat stops when none of the units the body consumes has a
    match left. A body that consumes nothing (`*ch 3* around`) is `E_REPEAT_UNEVEN` ("would never
    end"). A repetition that runs out part-way is `E_REPEAT_UNEVEN`, and later target errors in
    that round are suppressed.
16. **Repeat totals.** `rep from * N times` means N in total (3.7). `N more times` and
    `N times more` mean N+1.
17. **`same st` / `same sp` before anything was used.** These take the next stitch (or space for
    `sp`) and consume it. This applies in every round, not only joined ones.
18. **`in ring`** is the most recent ring of any round. `first ch` is the first chain of the most
    recent chain run.
19. **Cascade guard.** After a round with an error, the next round's target-family diagnostics
    are dropped while that round is also unreliable (it hit a would-be error of its own). These are
    E_NO_TARGET / NO_SPACE / SPACE_LENGTH / NO_CHAIN / REPEAT_UNEVEN / COUNT_MISMATCH,
    W_UNWORKED and I_UNWORKED_TCH. A parse-broken round suppresses its own count and unworked
    checks.
20. **`Diagnostic.round`** is the graph round index (`node.round`), not the label number.

## Grammar leniencies (accepted beyond the EBNF)

`3 ch` == `ch 3`; `ch` alone == `ch 1`; `ch-3` as an item; prepositions `over` (decreases) and
`to` (joins only); `around post of next dc`; `same st as join`; `(counts as dc here and
throughout)` / `(… throughout)`; `puff st`, `slip st`, `N-dc bobble`, `magic loop`, `p` = picot;
`dc in next st x3` repeats the whole item; `sc in blo` == `sc in blo of next st`; `every` ==
`each`; plural stitch units (`each dcs`). Under UK terms the US single-word slip-stitch spellings
`slst` / `sl` are also accepted (unambiguous). A picot with a target is `E_SYNTAX`.

## Hints

- The task brief mentioned a hint for "unknown stitch `dc` under `terms: UK`", but `dc` is valid in
  UK (= US sc). Hints are given the other way round instead: for US-only words (`sc`, `hdc`, `trc`
  and their compounds) under UK, and UK-only words (`htr`, `trtr`, `ttr`) under US. Everything else
  gets a "did you mean" (edit distance ≤ 1 for words of up to 3 letters, ≤ 2 otherwise).

## Fixtures and corpus

- All `spec/fixtures/*.expected.json` stitch counts are hit exactly; no fixture `.cro` needed a
  change.
- `data/corpus/hexagon-motif-6.cro` Rnd 5 once declared `(102 sc)`, but the instructions make 90
  (15 per side × 6). Its author has since fixed it.
