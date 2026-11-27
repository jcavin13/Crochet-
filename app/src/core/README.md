# app/src/core — pure TypeScript, no React, no DOM

Runs in node (vitest) and in the browser. One directory per concern:

| Dir | Owner concern |
|---|---|
| `notation/` | lexer, parser (text → AST), printer (US/UK), diagnostics |
| `graph/` | graph types (mirror of spec/pattern.schema.json), compiler (AST → graph), validation, queries |
| `flatness/` | analytic flatness check (spec/flatness.md) |
| `sim/` | real-time spring sim + shape metric (spec/physics.md) |
| `generate/` | generative doily designer |
| `amigurumi/` | surfaces of revolution, gauge calculators |

Public API of each directory is its `index.ts`. UI code lives in `src/features/*` and imports only from these indexes.
