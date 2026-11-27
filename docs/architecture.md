# Architecture

## One representation, many views

Everything is a view of the **stitch graph** (`spec/pattern.schema.json`):

```
            text notation (.cro)                generative programs
                   │ parse                              │ emit
                   ▼                                    ▼
                  AST ──compile──►  STITCH GRAPH  ◄─────┘
                                        │
     ┌──────────┬───────────┬───────────┼────────────┬─────────────┐
     ▼          ▼           ▼           ▼            ▼             ▼
  validator   chart      flatness    counter     physics sim    (later) 3D→pattern
 (counts,    (radial    (analytic   (pointer    (springs →       inverse
  targets)    SVG)       per round)  into nodes)  3D shape)
```

* **Nodes** are stitches, stored in working (yarn) order: node *i* is made right after node *i−1*.
  The array order *is* the work order, so the counter is an index, notation export is a walk, and a
  graph is crochetable by construction.
* **Anchors** (`node.into`) say what each leg of a stitch is worked into: another node or a
  **space**. Several stitches may share an anchor (increase, shell) and one stitch may have several
  (decrease, cluster): a directed multigraph.
* **Spaces** (chain spaces, rings) are first-class entities with ids, not derived geometry. Lace is
  mostly stitches worked into spaces; retrofitting them would touch every tool.
* **Rounds** index contiguous node ranges and carry the counts.

## Components

| Path | Language | Role |
|---|---|---|
| `spec/` | JSON / Markdown | The contracts: notation, vocabulary, graph schema, physics model, flatness rule, fixtures |
| `app/src/core/` | TypeScript, no DOM | notation → AST → graph, validation, flatness, real-time sim, generators |
| `app/src/features/`, `app/src/app/` | React | editor, chart, 3D view, designer, counter, gallery; PWA shell |
| `lab/src/crolab/` | Python | reference sim, discrete curvature, parameter fitting, swatch photo analysis, reports |
| `data/` | text | public-domain corpus transcribed into the notation, with `MANIFEST.csv` |

## Contracts between lab/ and app/

1. **Pattern format** — both read and write graph JSON valid against `spec/pattern.schema.json`.
   The TypeScript compiler is the only notation parser; the lab consumes compiled graphs
   (`spec/fixtures/*.graph.json`, corpus graphs) and its own programmatic builders.
2. **`spec/stitch_params.json`** — lab writes (nominal now, fitted from swatches later), app reads.
3. **Fixtures** — `spec/fixtures/<name>.expected.json` holds per-round stitch counts and the
   expected shape class. The app compiler must hit the counts; both sims must hit the class; the
   app sim must match the lab sim's reference metrics (`<name>.lab.json`) within the tolerances in
   `spec/sim_config.json`. CI runs all three, so the two sims cannot drift apart silently.

## Data flow in the app

`text → parse() → {ast, diagnostics} → compile() → {graph, diagnostics}`; every feature takes a
graph (plus `stitch_params`) and is a pure function of it: `flatness(graph, params)`,
`layoutChart(graph)`, `simulate(graph, params, {uptoRound, blocked})`. The designer produces
notation text (so its output is editable and goes through the same validator). Persistence is
local only: IndexedDB for the pattern library and counter progress; import/export as files.

## Why these choices

See `docs/decisions.md` for the log. In short: a hand-written recursive-descent parser because
error messages with exact positions are a headline feature; stitch-level (not yarn-level) physics
because the question is shape, not drape; the same spring network specified once in
`spec/physics.md` and solved twice (L-BFGS reference in Python, real-time in TypeScript) so the
interactive view is checkable; static site + PWA because Phase 1 has no backend and must run on a
phone at the sofa.
