// Network parity with the lab reference builder (crolab.network, metric variant): the anti-drift
// contract. L and k are compared within 1e-6 relative (plus the 5e-7 rounding of the file). Reference files: spec/fixtures/<name>.network.json (python -m crolab.export_network).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pattern } from '../graph';
import { paramsFor } from '../params';
import { buildNetwork, KIND_NAMES, springsOf, type Network } from './network';

const spec = fileURLToPath(new URL('../../../../spec/', import.meta.url));
const fixtures = spec + 'fixtures/';

type Row = [number, number, number, number, number, number];
interface RefFile {
  name: string; params: string; n_nodes: number; n_particles: number; n_springs: number;
  counts: Record<string, number>; n_slack: number; springs?: Row[];
  summary?: { sum_L: number; sum_k: number; sum_iL: number; sum_jk: number; pairs_hash: number; checksum: number };
}

const r6 = (x: number) => { const v = Math.round(x * 1e6) / 1e6; return v === 0 ? 0 : v; };

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let q = 0; q < text.length; q++) { h ^= text.charCodeAt(q); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function rows(net: Network): Row[] {
  return springsOf(net).map((s) => [s.i, s.j, s.L, s.k, s.kind, s.slack ? 1 : 0] as Row)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const names = readdirSync(fixtures).filter((f) => f.endsWith('.network.json')).map((f) => f.slice(0, -'.network.json'.length));

function loadGraph(name: string): Pattern {
  const p = name === 'tiny' ? spec + 'examples/tiny.graph.json' : fixtures + name + '.graph.json';
  return JSON.parse(readFileSync(p, 'utf8')) as Pattern;
}

describe('network parity with crolab.network (metric)', () => {
  it('has reference files for tiny and every fixture with a compiled graph', () => {
    expect(names).toContain('tiny');
    for (const f of readdirSync(fixtures).filter((x) => x.endsWith('.graph.json'))) {
      expect(existsSync(fixtures + f.replace('.graph.json', '.network.json')), f).toBe(true);
    }
  });
  for (const name of names) {
    it(name, () => {
      const ref = JSON.parse(readFileSync(fixtures + name + '.network.json', 'utf8')) as RefFile;
      const pat = loadGraph(name);
      const params = paramsFor(pat);
      expect(params.id).toBe(ref.params);
      const net = buildNetwork(pat, params);
      expect(net.nNodes).toBe(ref.n_nodes);
      expect(net.nParticles).toBe(ref.n_particles);
      expect(net.m).toBe(ref.n_springs);
      const counts: Record<string, number> = {};
      KIND_NAMES.forEach((k) => (counts[k] = 0));
      for (let s = 0; s < net.m; s++) counts[KIND_NAMES[net.kind[s]]]++;
      expect(counts).toEqual(ref.counts);
      const got = rows(net);
      expect(got.filter((r) => r[5]).length).toBe(ref.n_slack);
      if (ref.springs) {
        expect(got.length).toBe(ref.springs.length);
        const bad: string[] = [];
        got.forEach((r, q) => {
          const e = ref.springs![q];
          const same = r[0] === e[0] && r[1] === e[1] && r[4] === e[4] && r[5] === e[5]
            && Math.abs(r[2] - e[2]) <= 1e-6 * Math.abs(e[2]) + 5.01e-7
            && Math.abs(r[3] - e[3]) <= 1e-6 * Math.abs(e[3]) + 5.01e-7;
          if (!same && bad.length < 10) bad.push(`ts ${JSON.stringify(r)} lab ${JSON.stringify(e)}`);
        });
        expect(bad).toEqual([]);
      } else {
        const s = ref.summary!;
        const rr = got.map((r) => [r[0], r[1], r6(r[2]), r6(r[3]), r[4], r[5]] as Row);
        expect(fnv1a(rr.map((r) => `${r[0]},${r[1]},${r[4]},${r[5]};`).join(''))).toBe(s.pairs_hash);
        const sum = (f: (r: Row) => number) => rr.reduce((a, r) => a + f(r), 0);
        expect(sum((r) => r[2])).toBeCloseTo(s.sum_L, 4);
        expect(sum((r) => r[3])).toBeCloseTo(s.sum_k, 4);
        expect(sum((r) => r[0] * r[2])).toBeCloseTo(s.sum_iL, 2);
        expect(sum((r) => r[1] * r[3])).toBeCloseTo(s.sum_jk, 2);
      }
    });
  }
});
