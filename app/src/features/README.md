# app/src/features — one folder per page

Each feature is a lazily loaded page: `src/features/<name>/index.tsx` with a **default export**
(a React component, no props). The routes live in `src/app/App.tsx`; navigation entries in
`src/app/nav.ts`. Wave-2 agents replace the placeholder `index.tsx` of their feature and add
files next to it; they do not need to touch the shell.

| Route | Folder | Status |
|---|---|---|
| `#/` | `gallery/` | shell (demo gallery) |
| `#/library` | `library/` | shell |
| `#/editor/:id?` | `editor/` | shell (notation editor) |
| `#/chart/:id?` | `chart/` | placeholder → wave 2 |
| `#/sim/:id?` | `sim/` | placeholder → wave 2 (3D view) |
| `#/designer` | `designer/` | placeholder → wave 2 |
| `#/counter/:id?` | `counter/` | placeholder → wave 2 |
| `#/amigurumi` | `amigurumi/` | placeholder → wave 2 |
| `#/about` | `about/` | shell (about + settings) |

## Getting the current pattern

```tsx
import { useCurrentPattern, PatternPicker } from '@/app';

export default function ChartPage() {
  const { id, status, record, text, pattern, diagnostics, pending, readOnly, setText, duplicate, select } = useCurrentPattern();
  if (status !== 'ready') return null;            // 'loading' (library hydrating) | 'missing' (unknown id)
  return <>
    <PatternPicker value={id} />                   {/* navigates /<this-feature>/<id> */}
    {pattern ? <MyChart graph={pattern.graph} /> : <p>Fix the errors in the Editor first.</p>}
  </>;
}
```

* `id` — route `:id` if present, else the last pattern opened anywhere, else `fixture:simple_doily`.
  Ids: `fixture:<file>` and `corpus:<file>` for built-ins, `p-…` for the user's patterns.
* `pattern: Pattern | undefined` — the compiled stitch graph (`spec/pattern.schema.json`);
  undefined while the notation has errors. Compilation is debounced (250 ms) and cached, so several
  components can call the hook without recompiling.
* `diagnostics: Diagnostic[]`, `pending` (a debounced compile is outstanding).
* `setText(text)` — persist new notation (no-op on read-only built-ins; call `duplicate()` first,
  which copies to My patterns and navigates to the copy on the same feature route).
* `select(id)` — navigate this feature to another pattern.

Other helpers in `@/app`: `usePatternRecord(id)`, `useAllPatterns()` → `{ mine, builtins, hydrated }`,
`useCompiled(text, ms?)`, `patternHref(feature, id)` (e.g. `patternHref('chart', id)` →
`/chart/<id>` for `<Link to>`), `PatternGlyph` (decorative rosette thumbnail),
`builtins` / `fixtures` / `corpus`, `templates`.

Types (`Pattern`, `Diagnostic`, `GraphNode`, `GraphSpace`, `GraphRound`, `StitchType`, `Anchor`) are
re-exported from `@/app`. The shell reaches `src/core` only through `src/app/coreApi.ts`; features
import core modules they need (flatness, sim, generate…) directly from `@/core/<dir>`.

## Stitch parameters

```ts
import { useStitchParams } from '@/app';
const { selected, selectedId, sets, setting, setSelectedId, file } = useStitchParams(pattern);
// selected: { id, label, hook_mm, stitches: { sc: { width, height, stiffness }, … } }
```

Selection: the user's setting (About & settings) unless it is `'auto'`; then the pattern's
`params:` header (`pattern.meta.params`, or pass the text / an id); else `default_set`.
`setSelectedId('auto' | id)` changes the global setting.

## Settings and per-feature persistence

```ts
import { useSettings, usePersistentState } from '@/store';
const terms = useSettings((s) => s.terms);              // 'US' | 'UK' — the printer should honour it
const theme = useSettings((s) => s.theme);              // 'system' | 'light' | 'dark'
const [progress, setProgress, hydrated] = usePersistentState(`counter:${id}`, { round: 0, stitch: 0 });
```

`usePersistentState(key, initial)` is `useState` stored in IndexedDB (values must be
structured-cloneable). Namespace keys with your feature name. Writes are immediate; components using
the same key share the value. `hydrated` is false until the stored value has been read — do not
let the user write before that if overwriting matters.

The pattern library itself: `useLibrary` (`create`, `setText`, `duplicate`, `remove`, `flush`) from
`@/store`. The designer saves generated patterns with
`useLibrary.getState().create({ text, origin: 'designer' })` and can navigate to
`patternHref('editor', rec.id)`.

## UI kit (`@/ui`)

Layout: `Page` (`wide` for tool pages), `PageHeader` (`title`, `kicker`, `description`, `actions`),
`Section`, `SplitPane` (`panes=[{id,label,content}]`, side by side ≥ 900 px, tabs on phones;
optional controlled `active`/`onActiveChange`, `columns`).

Controls: `Button` (`variant` default|primary|ghost|danger, `size` md|sm, `icon`), `buttonClass()`
for styling a `<Link>` as a button, `IconButton` (`icon`, `label` required), `SegmentedControl`
(`options=[{value,label}]`, e.g. relaxed/blocked), `Slider` (`label`, `value`, `min`, `max`, `step`,
`format`), `Select` (`label`, native `<option>` children), `Input`, `Toggle`, `Tabs`, `Menu`
(`items=[{label, icon, onSelect, danger} | 'separator']`).

Display: `Card` (`flush`, `interactive`), `Badge` (`tone`: neutral|ok|error|warning|info|accent|outline|flat|cup|ruffle,
`dot`), `ShapeBadge shape="flat|cup|ruffle"`, `EmptyState`, `Dialog` (`sheet` = bottom sheet on
phones), `ConfirmDialog`, `toast(message, { tone })`, `Icon name=…` (see `ui/icons.tsx`), `BrandMark`.

Tokens (CSS variables in `ui/theme.css`, light + dark): `--bg --surface --surface-2 --border --ink
--ink-2 --ink-3 --accent --accent-soft --indigo --error --warning --info --ok`, and for shape classes
**`--shape-flat --shape-cup --shape-ruffle`** (+ `-soft` variants; Okabe–Ito, colour-blind safe —
always pair colour with a label or pattern). Spacing `--s-1…--s-8` (4 px grid), radii
`--radius-sm/--radius/--radius-lg`, fonts `--font-body --font-display --font-mono`, `--tap: 44px`.
In canvas/WebGL code read them with `getComputedStyle(document.documentElement).getPropertyValue('--shape-flat')`
and re-read when the theme changes (`useSettings((s) => s.theme)` plus `prefers-color-scheme`).

## Conventions

* Feature CSS: a plain `.css` file imported by your `index.tsx`, classes prefixed with a short
  feature code (`ch-`, `sim-`, `ctr-`…). No CSS frameworks. Use the tokens; no hard-coded colours.
* Phones first: touch targets ≥ 44 px (`--tap`), no hover-only affordances, test at 390×844.
  The bottom tab bar is fixed; `Page` already pads for it.
* Respect `prefers-reduced-motion` (global CSS shortens transitions; pause auto-running animation
  in JS too, e.g. the sim should not auto-spin).
* Heavy dependencies (three.js etc.) are only imported from your feature folder so they stay in
  your lazy chunk.
* Screenshots: add your routes to `ROUTES` in `app/scripts/screenshots.mjs`, then
  `npm run build && node scripts/screenshots.mjs <name>`; output in `docs/screenshots/`.
* Unit tests: `*.test.ts(x)` next to the code (vitest, node environment — no DOM).
