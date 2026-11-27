# Pattern corpus and test data

Crochet patterns worked in the round, written in the project notation (`spec/notation.md`), so the
compiler, chart, flatness analysis, simulators and designer have realistic lace to work on.

```
data/
  MANIFEST.csv                   one row per file in data/
  README.md                      this file
  corpus/<slug>.cro              patterns in notation v0.1 (bundled by the app as data/corpus/*.cro)
  corpus/NOTATION_FEEDBACK.md    gaps in notation v0.1 found while writing these patterns
  corpus/sources/<slug>.txt      (future) verbatim source text for each vintage transcription
  synthetic/swatches/            synthetic swatch photos + ground truth (see below)
```

The app bundles every `data/corpus/*.cro`, so **all patterns stay flat in `data/corpus/`**, with
no subfolders for `.cro` files. Original and vintage patterns are told apart by:

* the `source:` header: `original (written for this project, 2026)` vs the bibliographic source;
* the filename: future vintage transcriptions get a **`vintage-` prefix**
  (`vintage-dillmont-star-medallion.cro`). Original patterns have no prefix.

---

## A. Original project patterns (CC0)

Because the public-domain sources could not be reached (section B), the patterns below were
**designed new for this project** on 2026-11-27. They are not transcriptions or reconstructions of
any published pattern, vintage or modern. All are released under **CC0-1.0**. Every file:

* compiles with zero errors and zero warnings (`cd app && npx tsx scripts/check.ts ../data/corpus/*.cro`);
* has a count annotation on every round;
* carries `title`, `terms`, `yarn`, `hook`, `params`, `source`, `license` and `notes` (design
  intent and what it exercises);
* was designed to the rule in `spec/flatness.md` using the relative sizes in `spec/stitches.json`.
  Every round of the 14 flat designs falls inside the ±10 % tolerance (the chain-space min/max
  band). The two `teaching-` files are deliberately not flat.

| File | Title | Rnds | Symmetry | Techniques | Intended shape |
|---|---|---|---|---|---|
| `picot-coaster-24.cro` | Picot ring coaster | 3 | 24 | dc disc, picot + ch-1 edge | flat |
| `puff-star-coaster-5.cro` | Puff star coaster | 4 | 5 | 15-dc magic ring, puff, groups ×N, sk sp, ch-5 picot | flat (star) |
| `bobble-flower-coaster-6.cro` | Bobble flower coaster | 5 | 6 (12 inside) | bobble, 4-loop puff, 4-dc pc, hdc/dc/tr inc, `next pc` | flat (scalloped) |
| `granny-square-motif.cro` | Granny square motif | 5 | 4 | 3-dc groups, ch-2 corners, sl-st travel, chain ring | flat square (corner note) |
| `hexagon-motif-6.cro` | Hexagon cluster motif | 5 | 6 | beg cluster, 3-dc cl corners, side groups, sc + picot edge | flat hexagon (corner note) |
| `popcorn-ridge-mat-8.cro` | Popcorn ridge mat | 7 | 8 | hdc, BLO ridge, popcorn, fpdc rib, FLO sc + picot | flat, solid |
| `rep-from-star-rosette-8.cro` | Eight-petal rosette mat | 8 | 8 | every `rep from *` tail (N more / N times / around / to end), graduated petals, tr | flat |
| `uk-terms-wheel-16.cro` | Sixteen-spoke wheel mat | 8 | 16 | **`terms: UK`**, ss/miss, dtr spokes, picot petals, fans | flat |
| `sunburst-dtr-doily-20.cro` | Sunburst doily | 8 | 20 | `v-st` name, dtr, tr3tog over sts, ch-5/6 web, picot fans | flat |
| `spiral-sc-mat-fan-edge.cro` | Spiral sc mat with fan edge | 10 | 6 (12 edge) | **unjoined spiral** sc, `inc x6`, lace edge, 5-dc fans | flat |
| `solid-centre-lace-border-24.cro` | Solid centre doily with lace border | 10 | 24 border (12 centre) | **solid dc circle**, ch-5 loops, beg V + `v-st`, `3-dc shell`, picots | flat |
| `petal-doily-12.cro` | Twelve-petal doily | 12 | 12 | **petal doily**, 3-tr cl, `shell` / `3-dc shell`, ch-1 fans, mesh, picots | flat |
| `spiderweb-doily-10.cro` | Spiderweb doily | 12 | 10 | **spiderweb**, dc2tog/dc3tog wedges, growing loop web, 7-dc scallops, ch-5 picots | flat |
| `wheel-mesh-centrepiece-8.cro` | Wheel and mesh centrepiece | 15 | 8 (16 edge) | wedges + web, range label `Rnds 10-11`, 7-dc fans, ch-1 lattice, picot edge | flat |
| `teaching-ruffle-shell-doily.cro` | Teaching example: ruffled shell edge | 6 | 24 | over-increased shells | **ruffles** (Rnd 5 ≈ +100 %, Rnd 6 ≈ +200 %) |
| `teaching-cup-basket.cro` | Teaching example: little sc basket | 13 | 6 | sc base, BLO turn, `Rnds 8-12` with no increases | **cups** into a basket (Rnd 7 ≈ −14 % … Rnd 13 ≈ −54 %) |

Techniques covered at least once: ch / sl st / sc / hdc / dc / tr / dtr; chain-loop mesh; shells
written out as groups and with the `shell` name; V-stitches as groups and with `v-st`; plain
and `ch-N` picots; `cl`, `3-tr cl`, `bobble`, `dcNtog`/`trNtog` over stitches; puff and popcorn;
FLO, BLO and front-post rounds; fan and scallop edgings; UK terms; `rep from *` forms; spiral
rounds; chain and magic rings; range labels.

Notation problems met while writing these are listed in
[`corpus/NOTATION_FEEDBACK.md`](corpus/NOTATION_FEEDBACK.md), ranked by how much they matter for
vintage transcription.

To add another original pattern: same headers, `source: original (written for this project,
<year>)`, `license: CC0-1.0`, check it with the checker, add a row here and in `MANIFEST.csv`.
Do not base an "original" on a published pattern.

---

## B. Public-domain vintage corpus: not yet gathered (network-blocked)

Vintage crochet patterns worked in the round (doilies, mats, medallions, rosettes, wheels),
transcribed into the project notation so the tools can be tested against real, historically
worked designs.

### Status

**No vintage pattern has been transcribed yet.** The first gathering pass (2026-11-27) could not
reach any allowed source: the session's network policy blocks `www.gutenberg.org` and
`archive.org` (proxy: "no rule or network setting allows this host"). Patterns were deliberately
*not* reconstructed from memory, because a transcription must be checkable against a verbatim
source. Once those hosts are allowed, follow "How to add a pattern" below. Section A's original
patterns stand in until then.

### Licensing rules

These rules are strict; every file is audited against them.

1. **Allowed sources only**
   * Works first published **before 1929** (public domain in the US), taken from
     * Project Gutenberg (the e-text is itself public domain; record the ebook number and URL),
     * Internet Archive scans of public-domain works (record the item identifier and page),
     * Wikimedia Commons / Wikisource, only where the page states an explicit free licence,
     * the Antique Pattern Library **only after checking that item's stated licence**: many APL
       scans are CC BY-NC-SA even though the underlying work is PD. Prefer the same work from
       Gutenberg/IA; if APL is used, record its licence exactly and what was taken from it.
2. **Not allowed**: Ravelry, Pinterest, Etsy, Instagram, designer blogs, any modern copyrighted
   pattern, modern "reworked" versions of vintage patterns, or any site whose terms or
   `robots.txt` forbid automated retrieval. **If in doubt, leave it out.**
3. **Verbatim or nothing.** Every vintage `.cro` must have a `sources/<slug>.txt` holding the
   original instructions verbatim, with a header: book title, author, year, publisher,
   page/section, URL read, date retrieved. Nothing may be reconstructed from memory.
4. The `.cro` header carries `license: Public domain (published <year>)` and `source:` (book,
   author, year, page).
5. `MANIFEST.csv` lists every file in `data/` with columns
   `path,title,source_title,author,year,source_url,license,date_retrieved,purpose,notes`.

### How the corpus is gathered

1. Locate a pre-1929 book with in-the-round patterns on Project Gutenberg or Internet Archive
   (candidates: de Dillmont, *Encyclopedia of Needlework*, 1886; *Beeton's Book of Needlework*,
   1870; Riego de la Branchardière's crochet books; *The Priscilla Crochet Book*, 1912; Mary Card's
   books; pre-1929 thread-company booklets on IA).
2. Read the actual text (record the exact URL), and copy one pattern verbatim into
   `corpus/sources/<slug>.txt`.
3. Read the book's own stitch definitions and fix the terminology mapping (UK vs US; pre-1900
   authors vary).
4. Transcribe (below), hand-check every round's arithmetic, run the checker.

### How to add a pattern

1. Pick a slug with the **`vintage-` prefix** (`lowercase-with-hyphens`), e.g.
   `vintage-dillmont-star-medallion`. The `.cro` goes directly in `data/corpus/`, next to the
   original patterns, because the app bundles `data/corpus/*.cro`.
2. Write `corpus/sources/<slug>.txt`:
   ```
   Title:      <pattern title as printed>
   Book:       <book title>
   Author:     <author>
   Year:       <year of first publication>
   Publisher:  <publisher>
   Section:    <page / chapter / figure number>
   URL:        <exact URL read>
   Retrieved:  <YYYY-MM-DD>
   ---
   <verbatim instructions for this pattern only>
   ```
3. Write `corpus/<slug>.cro` with header lines `title`, `terms` (`UK` keeping original names, or
   `US` with the translation stated in `notes:`), `source`, `license`, `notes` (terminology
   mapping, ambiguities resolved, omitted parts, and `confidence: high|medium|low`).
   * Use `Rnd N:` lines and give explicit counts `( … )` at the end of each round.
   * Vintage "loop of 5 chain" = `ch-5 sp`; use `*…* xN`; resolve "repeat from *" against counts,
     and say in `notes:` how each ambiguous repeat was read (the notation cannot record it yet:
     NOTATION_FEEDBACK.md item 3).
   * If something cannot be expressed in v0.1 (joined motifs, working into earlier rounds or
     into picots, padding cords, bullion/roll stitches, stitches above dtr, colour changes),
     prefer another pattern, or transcribe only the expressible rounds and say exactly what was
     omitted. See `corpus/NOTATION_FEEDBACK.md` for the known gaps.
4. Run `cd app && npx tsx scripts/check.ts ../data/corpus/<slug>.cro`. Fix transcription errors to
   be faithful to the original; if the original is itself inconsistent, say so in `notes:`
   rather than "fixing" the pattern silently.
5. Add two rows to `MANIFEST.csv` (the `.cro` and the `.txt`) and a row to the table below.

### Vintage patterns

| Title | Source | Year | Rounds | Techniques | Confidence |
|---|---|---|---|---|---|
| *(none yet: sources blocked, see Status)* | | | | | |

---

## C. Synthetic test data

`data/synthetic/swatches/` holds **synthetic** swatch photos (`*.jpg`) and their ground truth
(`*.truth.json`: homography, camera tilt, stitch pitch). They are demo and test input for
`crolab.swatch.analyze`, generated by `python -m crolab.swatch.synth`, and are **not photographs
of real swatches**. CC0-1.0.
