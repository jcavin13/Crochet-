/**
 * npm run fixtures — compile every spec/fixtures/*.cro to <name>.graph.json next to it.
 *
 * spec/examples/tiny.cro is compiled too but NOT written over the hand-made tiny.graph.json:
 * it is compared (ignoring `src` and `notation`) and the compiled version goes to a temp dir.
 * Options: --check  (do not write; exit 1 if any graph file is missing or stale — for CI).
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePattern, formatDiagnostic } from '../src/core/notation/index';
import { stableJson, stripSrc } from '../src/core/graph/json';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../spec');
const fixturesDir = join(specDir, 'fixtures');
const checkOnly = process.argv.includes('--check');

let failed = false;

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
  const out = join(fixturesDir, f.replace(/\.cro$/, '.graph.json'));
  const json = stableJson(pattern);
  if (checkOnly) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== json) {
      console.error(`${out}: stale — run npm run fixtures`);
      failed = true;
    }
  } else {
    writeFileSync(out, json);
    console.log(`wrote ${out} (${pattern.graph.nodes.length} nodes, ${pattern.graph.rounds.length} rounds)`);
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
  const tmp = mkdtempSync(join(tmpdir(), 'crochet-tiny-'));
  writeFileSync(join(tmp, 'tiny.graph.json'), stableJson(tiny));
  console.log(`tiny.cro ${same ? 'matches' : 'DOES NOT MATCH'} tiny.graph.json (compiled copy: ${join(tmp, 'tiny.graph.json')})`);
  if (!same) failed = true;
}

process.exit(failed ? 1 : 0);
