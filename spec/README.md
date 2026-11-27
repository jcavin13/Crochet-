# spec/ — the contracts

Everything in `app/` (TypeScript) and `lab/` (Python) meets here. Change these files first, then the code.

| File | What it is |
|---|---|
| `notation.md` | Text notation (`.cro`): grammar, semantics, diagnostics |
| `stitches.json` | Stitch vocabulary: ids, US/UK names, turning-chain heights, chart symbols |
| `pattern.schema.json` | JSON Schema of the stitch graph — the format both sides read and write |
| `stitch_params.json` (+ schema) | Rest width / height / stiffness per stitch × yarn × hook. Written by `lab/`, read by `app/` |
| `physics.md`, `sim_config.json` | The spring network both simulators build, and the shape metric (flat / cup / ruffle) |
| `flatness.md` | The analytic per-round flatness check |
| `examples/tiny.*` | A small pattern compiled to a graph by hand — the Rosetta stone for implementers |
| `fixtures/<name>.cro` | Canonical patterns |
| `fixtures/<name>.expected.json` | Expected stitch counts per round, expected shape class, expected analytic classes |
| `fixtures/<name>.graph.json` | Graph compiled by the app compiler (`npm run fixtures` in `app/`); CI fails if stale |
| `fixtures/<name>.lab.json` | Reference metrics from the lab sim (`make lab-fixtures` at the repo root); the app sim must agree |
