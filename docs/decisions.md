# Decision log

| # | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 1 | Node array order = work order (single yarn in v0.1) | A graph is then crochetable by construction; counter and export are trivial. Matches the "current loop" insight in Guo et al. 2020 and knittable stitch meshes. | Unordered graph + topological sort (must then prove an order exists) |
| 2 | Chain spaces and rings are entities with ids; anchors point at node *or* space | Lace-first requirement; a stitch "in ch-3 sp" has no single chain it belongs to | Anchor to the middle chain (loses meaning, breaks charts and notation round-trip) |
| 3 | Decreases and clusters are one node with several anchors; increases/shells are several nodes with one anchor | Uniform: degree carries the meaning; no special node types | `inc`/`dec` node types |
| 4 | Graph always stores US stitch types; UK is a parse/print dialect | One vocabulary downstream | Storing source names |
| 5 | Hand-written lexer + recursive-descent parser in TypeScript | Positioned, crocheter-language diagnostics; error recovery per round; zero dependencies | PEG/parser generator |
| 6 | Only one notation parser (TS). Lab reads compiled graph JSON | Two parsers would drift; the graph is the contract | Python port of the parser |
| 7 | Stitch-level mass-spring network specified in `spec/physics.md`, solved twice | Shape (cup/flat/ruffle) is a metric question; yarn-level contact (Kaldor et al.) is far beyond need. Second-neighbour "bend" springs give the bending term the lit review asks for without a triangulation of lace | Yarn-level sim; FEM shells on a triangulated graph (lace has holes) |
| 8 | Round-by-round growth as the solve strategy, deterministic perturbation instead of random noise | Mirrors making; gives every intermediate round; reproducible across languages | Global solve from a flat start (crumpled minima on closed shapes) |
| 9 | Analytic flatness uses absolute circumference vs 2πρ with a compliance band for chain spaces | Matches Gauss–Bonnet and crocheters' "+6 per round" rule; chains are slack-tolerant, which is why lace is forgiving | Per-round increase rule only (misses accumulated error) |
| 10 | Vite + React + TypeScript, hash routing, `base: './'`, PWA | Static, works on GitHub Pages at any path and offline on a phone | Next.js (needs a server model we do not have) |
| 11 | `stitch_params.json` lives in `spec/` | It is a contract file both sides load; lab's fitting overwrites it | Under `lab/` (app would reach into lab) |
| 12 | Python env via `uv`, reports are jupytext notebooks executed to HTML and committed | One command, reproducible, viewable without running | Committed `.ipynb` (noisy diffs) |
