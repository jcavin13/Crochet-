/**
 * npm run fixtures — compile every spec/fixtures/*.cro to <name>.graph.json next to it, and write
 * <name>.flatness.json: the analytic flatness of every round (class, e_min, e_max, e, rho, r; floats
 * to 6 decimals). The lab pins its Python mirror of the flatness rule to these files (review R8).
 *
 * spec/examples/tiny.cro is compiled too but NOT written over the hand-made tiny.graph.json:
 * it is compared (ignoring `src` and `notation`); a mismatch writes the compiled copy to a temp dir.
 * spec/fixtures/extra/*.cro (references that are not canonical fixtures, e.g. a snowflake for the
 * spine rules of lab/SPEC_NOTES.md N5) are compiled to <name>.graph.json next to them, graph only.
 * Options: --check  (do not write; exit 1 if any graph file is missing or stale — for CI).
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePattern, formatDiagnostic } from '../src/core/notation/index';
import { stableJson, stripSrc } from '../src/core/graph/json';
import { analyzeFlatness } from '../src/core/flatness/index';
import { paramsFor } from '../src/core/params/index';
import type { Pattern } from '../src/core/graph/types';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../spec');
const fixturesDir = join(specDir, 'fixtures');
const checkOnly = process.argv.includes('--check');

let failed = false;

const r6 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 + 0 : x);

/** Golden flatness record of a fixture (shape agreed with lab/tests/test_flatness.py). */
function flatnessRecord(name: string, pattern: Pattern) {
  const rep = analyzeFlatness(pattern.graph, paramsFor(pattern));
  return {
    name,
    rounds: rep.rounds.map((r) => ({
      round: r.round, class: r.class, e_min: r6(r.eMin), e_max: r6(r.eMax), e: r6(r.e), rho: r6(r.rho), r: r6(r.r),
    })),
  };
}

function writeOrCheck(out: string, json: string, what: string) {
  if (checkOnly) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== json) {
      console.error(`${out}: stale — run npm run fixtures`);
      failed = true;
    }
  } else {
    writeFileSync(out, json);
    console.log(`wrote ${out} (${what})`);
  }
}

function compileFile(path: string) {
  const text = readFileSync(path, 'utf8');
  const res = compilePattern(text);
  for (const d of res.diagnostics) console.log(formatDiagnostic(d, path));
  if (!res.pattern) {
    console.error(`${path}: does not compile`);
    failed = true;
  }
  return res.pattern;
}

for (const f of readdirSync(fixturesDir).filter((x) => x.endsWith('.cro')).sort()) {
  const path = join(fixturesDir, f);
  const pattern = compileFile(path);
  if (!pattern) continue;
  const name = f.replace(/\.cro$/, '');
  writeOrCheck(join(fixturesDir, `${name}.graph.json`), stableJson(pattern),
    `${pattern.graph.nodes.length} nodes, ${pattern.graph.rounds.length} rounds`);
  writeOrCheck(join(fixturesDir, `${name}.flatness.json`), stableJson(flatnessRecord(name, pattern)), 'analytic flatness per round');
}

const extraDir = join(fixturesDir, 'extra');
if (existsSync(extraDir)) {
  for (const f of readdirSync(extraDir).filter((x) => x.endsWith('.cro')).sort()) {
    const pattern = compileFile(join(extraDir, f));
    if (!pattern) continue;
    writeOrCheck(join(extraDir, f.replace(/\.cro$/, '.graph.json')), stableJson(pattern),
      `${pattern.graph.nodes.length} nodes, ${pattern.graph.rounds.length} rounds (extra reference)`);
  }
}

// tiny: compare against the hand-compiled reference
const tinyPath = join(specDir, 'examples', 'tiny.cro');
const tiny = compileFile(tinyPath);
if (tiny) {
  const ref = JSON.parse(readFileSync(join(specDir, 'examples', 'tiny.graph.json'), 'utf8'));
  const got = stripSrc(tiny);
  delete (got as { notation?: string }).notation;
  const same = stableJson(got) === stableJson(stripSrc(ref));
  if (same) {
    console.log('tiny.cro matches tiny.graph.json');
  } else {
    // only on a mismatch: keep the compiled copy for diffing (review N5: no temp dir per run)
    const tmp = mkdtempSync(join(tmpdir(), 'crochet-tiny-'));
    writeFileSync(join(tmp, 'tiny.graph.json'), stableJson(tiny));
    console.log(`tiny.cro DOES NOT MATCH tiny.graph.json (compiled copy: ${join(tmp, 'tiny.graph.json')})`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
