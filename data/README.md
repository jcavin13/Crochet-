# Public-domain pattern corpus

Vintage crochet patterns worked in the round (doilies, mats, medallions, rosettes, wheels),
transcribed into the project notation (`spec/notation.md`) so that the compiler, chart, flatness
analysis and simulators can be tested against real, historically worked designs.

```
data/
  MANIFEST.csv            one row per file in data/
  README.md               this file
  corpus/<slug>.cro       transcription in notation v0.1
  corpus/sources/<slug>.txt   verbatim original text + bibliographic header
```

## Status

**The corpus is currently empty.** The first gathering pass (2026-11-27) could not reach any
allowed source: the session's network policy blocks `www.gutenberg.org` and `archive.org`
(proxy: "no rule or network setting allows this host"). Patterns were deliberately *not*
reconstructed from memory, because a transcription must be checkable against a verbatim source.
Once those hosts are allowed, follow "How to add a pattern" below.

## Licensing rules

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
3. **Verbatim or nothing.** Every `.cro` must have a `sources/<slug>.txt` holding the original
   instructions verbatim, with a header: book title, author, year, publisher, page/section, URL
   read, date retrieved. Nothing may be reconstructed from memory.
4. The `.cro` header carries `license: Public domain (published <year>)` and `source:` (book,
   author, year, page).
5. `MANIFEST.csv` lists every file in `data/` with columns
   `path,title,source_title,author,year,source_url,license,date_retrieved,purpose,notes`.

## How the corpus is gathered

1. Locate a pre-1929 book with in-the-round patterns on Project Gutenberg or Internet Archive
   (candidates: de Dillmont, *Encyclopedia of Needlework*, 1886; *Beeton's Book of Needlework*,
   1870; Riego de la Branchardière's crochet books; *The Priscilla Crochet Book*, 1912; Mary Card's
   books; pre-1929 thread-company booklets on IA).
2. Read the actual text (record the exact URL), and copy one pattern verbatim into
   `sources/<slug>.txt`.
3. Read the book's own stitch definitions and fix the terminology mapping (UK vs US; pre-1900
   authors vary).
4. Transcribe (below), hand-check every round's arithmetic, run the checker.

## How to add a pattern

1. Pick a slug (`lowercase-with-hyphens`), e.g. `dillmont-star-medallion`.
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
   * Vintage "loop of 5 chain" = `ch-5 sp`; use `*…* xN`; resolve "repeat from *" against counts.
   * If something cannot be expressed in v0.1 (joined motifs, working into earlier rounds,
     padding cords, bullion/roll stitches, colour changes) prefer another pattern, or transcribe
     only the expressible rounds and say exactly what was omitted.
4. Run `cd app && npx tsx scripts/check.ts ../data/corpus/<slug>.cro` (when available). Fix
   transcription errors to be faithful to the original; if the original is itself inconsistent,
   say so in `notes:` rather than "fixing" the pattern silently.
5. Add two rows to `MANIFEST.csv` (the `.cro` and the `.txt`) and a row to the table below.

## Patterns

| Title | Source | Year | Rounds | Techniques | Confidence |
|---|---|---|---|---|---|
| *(none yet: sources blocked, see Status)* | | | | | |
