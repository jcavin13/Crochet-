// Feature-level checks that run in node: the sim driver (the code inside the worker and the
// main-thread fallback), the render topology, and the 2D SVG fallback rendering.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Pattern } from '@/core/graph';
import { paramsFor, simConfig } from '@/core/params';
import { simulate } from '@/core/sim';
import { createDriver } from './driver';
import type { SimFrame } from './protocol';
import { SvgView } from './SvgView';
import { buildTopology, parseColor, rotationToY, type Palette } from './topology';

const fixtures = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(fixtures + n + '.graph.json', 'utf8')) as Pattern;

const palette: Palette = {
  roundA: [0.6, 0.2, 0.1], roundB: [0.2, 0.3, 0.5], chain: [0.5, 0.5, 0.5], ink: [0.1, 0.1, 0.1], muted: [0.4, 0.4, 0.4],
  flat: [0, 0.5, 0.3], cup: [0, 0.4, 0.6], ruffle: [0.8, 0.3, 0], tension: [0.8, 0.3, 0], compression: [0, 0.4, 0.6],
  neutral: [0.6, 0.6, 0.6], highlight: [0.5, 0.3, 0], bg: [1, 1, 0.95], dark: false,
};

describe('sim driver (worker body / main-thread fallback)', () => {
  it('grows, reports frames, then the solved metric; scrubbing back is answered from the snapshot', async () => {
    const pat = load('sc_cone');
    const frames: SimFrame[] = [];
    let resolve!: () => void;
    let wanted = 1;
    const doneP = () => new Promise<void>((r) => { resolve = r; });
    let p = doneP();
    const driver = createDriver({
      budget: 5,
      schedule: (fn) => setTimeout(fn, 0),
      emit: (f) => { frames.push(f); if (f.step.done && --wanted === 0) resolve(); },
      error: (_j, m) => { throw new Error(m); },
    });
    driver.handle({ type: 'init', job: 1, graph: pat.graph, params: paramsFor(pat), config: simConfig, uptoRound: 7, blocked: false });
    await p;
    const last = frames[frames.length - 1];
    expect(frames.length).toBeGreaterThan(1);               // intermediate growth frames were sent
    expect(last.metric?.class).toBe('cup');
    expect(last.accuracy).toBe('reference');
    expect(last.strain?.length).toBeGreaterThan(0);
    const ref = simulate(pat, paramsFor(pat));
    expect(Array.from(last.positions)).toEqual(Array.from(Float32Array.from(ref.positions)));
    // scrub to round 2: one frame, done immediately
    const before = frames.length;
    wanted = 1; p = doneP();
    driver.handle({ type: 'upto', job: 1, round: 2 });
    await p;
    expect(frames.length).toBe(before + 1);
    expect(Array.from(frames[frames.length - 1].positions)).toEqual(Array.from(Float32Array.from(ref.snapshots[2])));
    // blocked: verdict reported
    wanted = 1; p = doneP();
    driver.handle({ type: 'upto', job: 1, round: 7 });
    driver.handle({ type: 'blocked', job: 1, blocked: true });
    await p;
    await new Promise((r) => setTimeout(r, 50));
    const b = frames[frames.length - 1];
    expect(b.block?.verdict).toBeDefined();
    driver.handle({ type: 'dispose', job: 1 });
  });
});

describe('render topology and SVG fallback', () => {
  const pat = load('simple_doily');
  const res = simulate(pat, paramsFor(pat), { gtolRound: 1e-4, gtolFinal: 1e-5 });
  const topo = buildTopology(res.network);

  it('one post per (stitch, anchor), yarn through consecutive tops, slack loops marked light', () => {
    const legs = res.network.anchors.reduce((s, a) => s + a.length, 0);
    expect(topo.stitches.count).toBe(legs);
    expect(topo.yarn.count).toBe(res.network.nNodes - 1);
    expect(Array.from(topo.yarn.light).some((x) => x === 1)).toBe(true);
    expect(Array.from(topo.stitches.spring).every((s) => s >= 0)).toBe(true);
  });

  it('rotationToY takes the axis to +Y', () => {
    for (const a of [[0, 0, 1], [1, 2, -3], [0, -1, 0], [0.3, 0.9, 0.1]] as [number, number, number][]) {
      const n = Math.hypot(...a);
      const R = rotationToY(a);
      const y = [R[0] * a[0] + R[1] * a[1] + R[2] * a[2], R[3] * a[0] + R[4] * a[1] + R[5] * a[2], R[6] * a[0] + R[7] * a[1] + R[8] * a[2]];
      expect(y[0] / n).toBeCloseTo(0, 9); expect(y[1] / n).toBeCloseTo(1, 9); expect(y[2] / n).toBeCloseTo(0, 9);
    }
  });

  it('SvgView draws every segment and top of the solved piece', () => {
    const html = renderToStaticMarkup(
      <SvgView topology={topo} positions={Float32Array.from(res.positions)} rotation={rotationToY([0, 0, 1])}
        colors={{ by: 'round', palette }} highlightNode={5} />,
    );
    expect((html.match(/<line /g) ?? []).length).toBe(topo.stitches.count + topo.yarn.count);
    expect((html.match(/<circle /g) ?? []).length).toBe(topo.nNodes + 1);
    expect(html).not.toMatch(/NaN/);
  });

  it('parses theme colours', () => {
    expect(parseColor('#a3412a')).toEqual([0xa3 / 255, 0x41 / 255, 0x2a / 255]);
    expect(parseColor(' rgb(10, 20, 30)')).toEqual([10 / 255, 20 / 255, 30 / 255]);
    expect(parseColor('nonsense', [1, 2, 3])).toEqual([1, 2, 3]);
  });
});
