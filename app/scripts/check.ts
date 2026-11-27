/**
 * npm run check -- <files…>   |   npx tsx scripts/check.ts <files…>
 *
 * Compiles each .cro file, prints diagnostics as `file:line:col severity CODE message` and a
 * per-round stitch-count summary. Exit code 1 if any file has errors.
 * Options: --quiet (diagnostics only, no summary).
 */
import { readFileSync } from 'node:fs';
import { compilePattern, formatDiagnostic } from '../src/core/notation/index';
import { roundSummary } from '../src/core/graph/queries';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: npm run check -- <file.cro> [more.cro …] [--quiet]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`${file}: cannot read (${(e as Error).message})`);
    failed = true;
    continue;
  }
  const res = compilePattern(text);
  for (const d of res.diagnostics) console.log(formatDiagnostic(d, file));
  const errors = res.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = res.diagnostics.filter((d) => d.severity === 'warning').length;
  if (errors) failed = true;
  if (!quiet && res.pattern) {
    const g = res.pattern.graph;
    for (const r of g.rounds) {
      const s = roundSummary(g, r.index);
      const types = Object.entries(s.byType).map(([k, v]) => `${v} ${k}`).join(', ');
      const sps = Object.entries(s.spaces).map(([k, v]) => `${v} ch-${k} sp`).join(', ');
      const flags = [r.joined ? 'joined' : '', r.turned ? 'turned' : ''].filter(Boolean).join(' ');
      console.log(`  ${r.label.padEnd(12)} ${String(r.stitchCount).padStart(4)} sts  [${types}${sps ? `; ${sps}` : ''}]${flags ? ` ${flags}` : ''}`);
    }
  }
  console.log(`${file}: ${errors ? 'FAIL' : 'ok'} — ${errors} error(s), ${warnings} warning(s)${res.pattern ? `, ${res.pattern.graph.rounds.length} rounds, ${res.pattern.graph.nodes.length} nodes` : ''}`);
}
process.exit(failed ? 1 : 0);
