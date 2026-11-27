/**
 * Blankets in the chart: bodies worked in rows with a border worked round them (rounded-rectangle
 * courses), pieces worked from the centre with corners (polygons), pieces worked round both sides
 * of a foundation chain (stadiums). Designs come from the blanket studio (core/blanket).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC, ROUND_STYLES, STITCH_PATTERNS, designBlanket, type BlanketSpec } from '../blanket';
import type { Graph } from '../graph';
import { compilePattern } from '../notation';
import { paramsFor } from '../params';
import { borderCornerGroups, buildHitIndex, chartToSvg, cornerView, frameHeight, hitTest, layoutChart, roundAt, wedgeView, BORDER_NOTE } from './index';
import type { ChartLayout, ChartNode } from './types';

const rectSpec = (pattern: string, layers: string[]): BlanketSpec => ({
  ...DEFAULT_SPEC, construction: 'rect', body: { pattern },
  border: { enabled: true, rowEnds: 'auto', edgeCorner: 'sc3', edgeColor: 'E', layers: layers.map((kind) => ({ kind: kind as never, color: 'A' })) },
});
const roundSpec = (style: string, textures: string[], size = 90): BlanketSpec => ({
  ...DEFAULT_SPEC, construction: 'round', size: { widthCm: size, heightCm: size + 30 }, round: { style: style as never, textures: textures as never, corner: 'auto' },
});

function swatchOf(spec: BlanketSpec) {
  const d = designBlanket(spec, undefined, { fullLimit: 0 });
  expect(d.swatch, `${spec.body.pattern} swatch compiles: ${d.diagnostics.swatch.filter((x) => x.severity === 'error').map((x) => x.message).join('; ')}`).toBeTruthy();
  return { graph: d.swatch!.graph, params: d.params, text: d.swatchText };
}

function expectFinite(L: ChartLayout, where: string) {
  for (const m of L.nodes) {
    for (const v of [m.x, m.y, m.cx, m.cy, m.rot, m.s, m.r]) expect(Number.isFinite(v), `${where}: node ${m.id}`).toBe(true);
    for (const p of m.legs) expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${where}: leg of ${m.id}`).toBe(true);
  }
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(Number.isFinite(L.bounds[k]), where).toBe(true);
}

type Side = 'top' | 'right' | 'bottom' | 'left' | 'corner';

/** Which side of the body each border node is worked on, from its anchors (row ends, foundation chain, last row; later rounds inherit). */
function sidesOf(g: Graph, L: ChartLayout): Map<number, Side> {
  const shape = L.shape;
  if (shape?.kind !== 'border') throw new Error('no border');
  const xs = shape.rect.map((p) => p.x);
  const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const from = shape.from;
  const corner = new Set<number>();
  // corner groups: border nodes worked into a corner (compiler's corners, recomputed)
  const lastRow = from - 1;
  const memo = new Map<number, Side>();
  const sideOfNode = (id: number, depth = 0): Side => {
    if (memo.has(id)) return memo.get(id)!;
    const n = g.nodes[id];
    let s: Side = 'top';
    if (depth > 50) return s;
    if (n.round < from) s = 'top';
    else if (!n.into.length) s = id > g.rounds[n.round].first ? sideOfNode(id - 1, depth + 1) : 'top';
    else {
      const a = n.into[0];
      if ('space' in a) s = sideOfNode(g.spaces[a.space].chains[0], depth + 1);
      else if (a.part === 'side') s = L.nodes[a.node].x < xMid ? 'left' : 'right';
      else if (a.part === 'base') s = 'bottom';
      else if (g.nodes[a.node].round === lastRow) s = 'top';
      else s = sideOfNode(a.node, depth + 1);
    }
    memo.set(id, s);
    return s;
  };
  for (let k = from; k < g.rounds.length; k++) {
    const R = g.rounds[k];
    for (let id = R.first; id <= R.last; id++) sideOfNode(id);
  }
  void corner;
  return memo;
}

describe('rows with a border round them', () => {
  const layers3 = ['sc', 'sc']; // + the edge round = 3 border rounds
  for (const pat of STITCH_PATTERNS) {
    it(`${pat.id}: body in rows, 3 border rounds round it`, () => {
      const { graph: g, params } = swatchOf(rectSpec(pat.id, layers3));
      const L = layoutChart(g, params);
      expectFinite(L, pat.id);
      expect(L.mode).toBe('rows');
      const shape = L.shape;
      expect(shape?.kind).toBe('border');
      if (shape?.kind !== 'border') return;
      const xs = shape.rect.map((p) => p.x), ys = shape.rect.map((p) => p.y);
      const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      const border = L.rounds.filter((r) => r.border);
      expect(border.length, pat.id).toBe(3);
      const sides = sidesOf(g, L);
      const corners = new Set([...borderCornerGroups(g).values()].flat(2));
      const tol = 0.05;
      // stitches on each side lie outside the body's box on that side; corner groups at the corners
      let checked = 0;
      for (const r of border) {
        for (let id = r.first; id <= r.last; id++) {
          const m = L.nodes[id], n = g.nodes[id];
          if (m.kind !== 'stitch') continue;
          const side = sides.get(id)!;
          const outX = m.cx < box.minX - tol || m.cx > box.maxX + tol, outY = m.cy < box.minY - tol || m.cy > box.maxY + tol;
          if (corners.has(id)) {
            // a corner group fans round its corner: outside the body, close to one of its corners
            expect(outX || outY, `${pat.id} corner node ${id} outside the body`).toBe(true);
          }
          if (corners.has(id) || (outX && outY)) {
            // round a corner: close to one of the body's corners
            const d = Math.min(...shape.rect.map((p) => Math.hypot(m.cx - p.x, m.cy - p.y)));
            expect(d, `${pat.id} node ${id} round the corner`).toBeLessThan(r.rOuter + 1.5);
            continue;
          }
          const ok = side === 'top' ? m.cy < box.minY - tol || m.y < box.minY - tol
            : side === 'bottom' ? m.cy > box.maxY + tol
            : side === 'left' ? m.cx < box.minX - tol
            : m.cx > box.maxX + tol;
          // (a stitch next to a corner group may be pushed round the corner's arc: still outside the
          // body, at the corner)
          const nearCorner = Math.min(...shape.rect.map((p) => Math.hypot(m.cx - p.x, m.cy - p.y)));
          if (!ok && (outX || outY) && nearCorner < r.rOuter + 0.8) continue;
          expect(ok, `${pat.id} ${r.label} node ${id} (${n.type}) on the ${side}: (${m.cx.toFixed(2)}, ${m.cy.toFixed(2)}) vs body ${JSON.stringify(box)}`).toBe(true);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(20);
      // corner groups: the stitches worked into each corner fan round one of the body's corners
      // (their tops are diagonal from it, beyond both sides)
      for (const r of border) {
        const fr = r.frame!;
        expect(fr, `${r.label} has its frame`).toBeTruthy();
      }
      // rounds nest outwards, and adjacent rounds' symbols do not overlap
      for (let i = 1; i < border.length; i++) expect(border[i].r, `${pat.id} ${border[i].label}`).toBeGreaterThan(border[i - 1].r + 0.4);
      for (let i = 1; i < border.length; i++) {
        const a = border[i - 1], b = border[i];
        const tops = (r: typeof a) => L.nodes.slice(r.first, r.last + 1).filter((m) => m.kind === 'stitch');
        const A = tops(a), B = tops(b);
        let close = 0;
        for (const p of B) for (const q of A) if (Math.hypot(p.x - q.x, p.y - q.y) < 0.3) close++;
        expect(close, `${pat.id}: ${b.label} tops on ${a.label} tops`).toBeLessThanOrEqual(1);
      }
      // the border rounds' heights are measured from the body (its frame)
      for (const r of border) {
        let h = 0, c = 0;
        for (let id = r.first; id <= r.last; id++) if (L.nodes[id].kind === 'stitch') { h += frameHeight(r.frame!, L.nodes[id].x, L.nodes[id].y); c++; }
        expect(Math.abs(h / c - r.r), `${r.label} mean height`).toBeLessThan(0.05);
      }
    });
  }

  it('the first border round starts at a top corner; a shell border reads as one (fans at the corners)', () => {
    const { graph: g, params } = swatchOf(rectSpec('dc', ['sc', 'shell']));
    const L = layoutChart(g, params);
    const shape = L.shape!;
    expect(shape.kind).toBe('border');
    if (shape.kind !== 'border') return;
    const ys = shape.rect.map((p) => p.y);
    const R1 = L.rounds[shape.from];
    // its first stitch is near a top corner
    let first: ChartNode | undefined;
    for (let id = R1.first; id <= R1.last; id++) if (L.nodes[id].kind === 'stitch') { first = L.nodes[id]; break; }
    const dTop = Math.min(...shape.rect.filter((p) => p.y === Math.min(...ys)).map((p) => Math.hypot(first!.x - p.x, first!.y - p.y)));
    expect(dTop).toBeLessThan(2.5);
    // the shell round: 5-dc shells; the corner shells fan round the four corners
    const last = L.rounds[L.rounds.length - 1];
    const dcs = L.nodes.slice(last.first, last.last + 1).filter((m) => m.type === 'dc');
    expect(dcs.length).toBeGreaterThan(20);
    for (const c of shape.rect) {
      const near = dcs.filter((m) => Math.hypot(m.x - c.x, m.y - c.y) < last.r + 1.5);
      expect(near.length, `corner (${c.x}, ${c.y})`).toBeGreaterThanOrEqual(4);
      // fanned: their directions span a good part of the quarter turn
      const ang = near.map((m) => m.rot);
      expect(Math.max(...ang) - Math.min(...ang)).toBeGreaterThan(0.6);
    }
    // legend says what a border round is judged by
    expect(chartToSvg(L)).toContain(BORDER_NOTE.replace(/'/g, '&#39;').slice(0, 10));
  });

  it('corner detail: one bottom corner, the first rows and every border round', () => {
    const { graph: g, params } = swatchOf(rectSpec('moss', ['sc', 'shell']));
    const L = layoutChart(g, params);
    const C = cornerView(L)!;
    expect(C).toBeTruthy();
    expect(C.kind).toBe('corner');
    const full = C.inside.filter((v) => v === 2).length;
    expect(full).toBeGreaterThan(30);
    expect(full).toBeLessThan(L.nodes.length * 0.7);
    // nodes of the first row and of every border round are in it
    const rounds = new Set<number>();
    for (const m of L.nodes) if (C.inside[m.id] === 2) rounds.add(m.round);
    for (const r of L.rounds) if (r.border) expect(rounds.has(r.index), r.label).toBe(true);
    expect(rounds.has(1)).toBe(true);
    // labels: rows and border rounds
    expect(C.labels.some((l) => l.text === '1')).toBe(true);
    expect(C.labels.some((l) => l.text === 'R1')).toBe(true);
    const svg = chartToSvg(L, { wedge: C });
    expect(svg).toContain('Corner detail');
    // the round view helpers do not apply to rows
    expect(wedgeView(L, 4)).toBeNull();
  });

  it('hit testing and round lookup in the border', () => {
    const { graph: g, params } = swatchOf(rectSpec('dc', ['sc', 'sc']));
    const L = layoutChart(g, params);
    const ix = buildHitIndex(L);
    const R = L.rounds.filter((r) => r.border)[1];
    const m = L.nodes.slice(R.first, R.last + 1).find((x) => x.kind === 'stitch')!;
    expect(hitTest(ix, m.cx, m.cy)).toBe(m.id);
    // a point half-way up the round's band, beside the body
    const shape = L.shape!;
    if (shape.kind !== 'border') throw new Error('border');
    const xR = Math.max(...shape.rect.map((p) => p.x)), ys = shape.rect.map((p) => p.y);
    expect(roundAt(L, xR + (R.r0 + R.r) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)).toBe(R.index);
    // inside the body: a row
    const row = L.rounds.find((r) => r.kind === 'row')!;
    expect(roundAt(L, (Math.min(...shape.rect.map((p) => p.x)) + xR) / 2, -(row.r0 + row.r) / 2)).toBe(row.index);
  });

  it('a full baby blanket (~10 k stitches) lays out in well under a second', () => {
    const d = designBlanket({ ...DEFAULT_SPEC, size: { widthCm: 60, heightCm: 60 }, body: { pattern: 'moss' } }, undefined, { fullLimit: 20_000 });
    expect(d.pattern).toBeTruthy();
    const g = d.pattern!.graph;
    expect(g.nodes.length).toBeGreaterThan(5000);
    const t0 = performance.now();
    const L = layoutChart(g, d.params);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(L.shape?.kind).toBe('border');
    expectFinite(L, 'full blanket');
  });
});

/** Stitch tops of the round, and whether each is on a straight side (not round a corner). */
function sideCheck(L: ChartLayout, k: number, n: number, where: string) {
  const R = L.rounds[k];
  const fr = R.frame!;
  expect(fr, `${where}: round ${R.label} has a polygon frame`).toBeTruthy();
  expect(fr.core.length).toBe(n);
  const V = fr.core;
  // side j: from V[j] to V[j+1]; a point is on its straight part when its projection falls inside
  const tops = L.nodes.slice(R.first, R.last + 1).filter((m) => m.kind === 'stitch' && m.role === undefined);
  const bySide: number[][] = Array.from({ length: n }, () => []);
  const typeOf = new Map<string, number>();
  let onSides = 0;
  for (const m of tops) {
    for (let j = 0; j < n; j++) {
      const p = V[j], q = V[(j + 1) % n];
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
      const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / len;
      // outward normal on the page: the core is counter-clockwise on the page (y down)
      const nx = -dy / len, ny = dx / len;
      const h = (m.x - p.x) * nx + (m.y - p.y) * ny;
      if (t > 0.3 && t < len - 0.3 && h > 0) { bySide[j].push(h); typeOf.set(`${j}:${m.type}`, (typeOf.get(`${j}:${m.type}`) ?? 0) + 1); onSides++; break; }
    }
  }
  expect(onSides, `${where}: stitches on the straight sides`).toBeGreaterThan(n);
  // collinear: on each side, the tops of the round's stitches lie on one line (within tolerance)
  for (let j = 0; j < n; j++) {
    const hs = bySide[j];
    if (hs.length < 2) continue;
    const spread = Math.max(...hs) - Math.min(...hs);
    expect(spread, `${where}: side ${j} of ${R.label} straight`).toBeLessThan(0.35);
  }
}

/** The round's stitch tops map onto themselves under a turn of 2π/n (most of them; the seam may differ). */
function nFold(L: ChartLayout, k: number, n: number, where: string) {
  const R = L.rounds[k];
  const tops = L.nodes.slice(R.first, R.last + 1).filter((m) => m.kind === 'stitch');
  const a = (2 * Math.PI) / n, c = Math.cos(a), s = Math.sin(a);
  let ok = 0;
  for (const m of tops) {
    const x = m.x * c + m.y * s, y = -m.x * s + m.y * c;
    if (tops.some((o) => Math.hypot(o.x - x, o.y - y) < 0.35)) ok++;
  }
  expect(ok / tops.length, `${where}: ${R.label} ${n}-fold`).toBeGreaterThan(0.85);
}

describe('blankets worked in the round: polygons and stadiums', () => {
  const polys = ROUND_STYLES.filter((s) => s.sides > 0 && s.id !== 'rect-round');
  for (const style of polys) {
    it(`${style.id}: ${style.sides} straight sides, ${style.sides}-fold`, () => {
      let g: Graph, params;
      if (style.id === 'circle-to-square') {
        // the swatch is the circle centre: the whole (small) blanket squares it off
        const d = designBlanket(roundSpec(style.id, style.defaultTextures, 30), undefined, { fullLimit: 20_000 });
        expect(d.pattern).toBeTruthy();
        g = d.pattern!.graph; params = d.params;
      } else {
        const sw = swatchOf(roundSpec(style.id, style.defaultTextures));
        g = sw.graph; params = sw.params;
      }
      const L = layoutChart(g, params);
      expectFinite(L, style.id);
      expect(L.mode).toBe('radial');
      expect(L.shape, style.id).toEqual(expect.objectContaining({ kind: 'polygon', n: style.sides }));
      const last = g.rounds.length - 1;
      sideCheck(L, last, style.sides, style.id);
      nFold(L, last, style.sides, style.id);
      // rounds nest outwards; the band is drawn as the polygon
      const R = L.rounds.filter((r) => r.first >= 0);
      for (let i = 1; i < R.length; i++) expect(R[i].r).toBeGreaterThan(R[i - 1].r);
      const svg = chartToSvg(L);
      expect(svg).toMatch(/<path d="M[^"]*L[^"]*Z[^"]*" fill="/);
    });
  }

  it('rect-round: worked round both sides of the chain, laid out as a stadium', () => {
    const { graph: g, params } = swatchOf(roundSpec('rect-round', ['sc']));
    const L = layoutChart(g, params);
    expectFinite(L, 'rect-round');
    expect(L.shape?.kind).toBe('stadium');
    // the foundation chain is a straight line
    const R0 = L.rounds[0];
    for (let id = R0.first; id <= R0.last; id++) expect(Math.abs(L.nodes[id].y)).toBeLessThan(1e-9);
    // each round: the stitches on the long sides lie on two straight lines, above and below the chain
    const core = L.rounds[1].frame!.core;
    const [x0, x1] = [Math.min(core[0].x, core[1].x), Math.max(core[0].x, core[1].x)];
    for (const R of L.rounds.slice(1)) {
      const tops = L.nodes.slice(R.first, R.last + 1).filter((m) => m.kind === 'stitch' && m.x > x0 + 1 && m.x < x1 - 1);
      const up = tops.filter((m) => m.y < 0).map((m) => m.y), down = tops.filter((m) => m.y > 0).map((m) => m.y);
      expect(up.length).toBeGreaterThan(10);
      expect(down.length).toBeGreaterThan(10);
      expect(Math.max(...up) - Math.min(...up), `${R.label} top side`).toBeLessThan(0.05);
      expect(Math.max(...down) - Math.min(...down), `${R.label} bottom side`).toBeLessThan(0.05);
      expect(Math.abs(Math.max(...up) + Math.min(...down)), `${R.label} symmetric`).toBeLessThan(0.05);
    }
  });

  it('circles, mandalas and the circle-to-square centre stay circles', () => {
    for (const id of ['circle', 'mandala', 'circle-to-square']) {
      const s = ROUND_STYLES.find((x) => x.id === id)!;
      const { graph: g, params } = swatchOf(roundSpec(id, s.defaultTextures));
      expect(layoutChart(g, params).shape, id).toBeUndefined();
    }
  });
});

describe('cornered motifs in the corpus', () => {
  const corpus = (name: string) => {
    const r = compilePattern(readFileSync(new URL(`../../../../data/corpus/${name}.cro`, import.meta.url), 'utf8'));
    expect(r.pattern, name).toBeTruthy();
    return r.pattern!;
  };
  it('the granny square draws as a square, the hexagon motif as a hexagon', () => {
    for (const [name, n] of [['granny-square-motif', 4], ['hexagon-motif-6', 6]] as const) {
      const p = corpus(name);
      const L = layoutChart(p.graph, paramsFor(p));
      expect(L.shape, name).toEqual(expect.objectContaining({ kind: 'polygon', n }));
      const last = p.graph.rounds.length - 1;
      nFold(L, last, n, name);
      // a granny square sits on a side: its sides level
      if (n === 4) {
        const V = L.rounds[last].frame!.core;
        for (let j = 0; j < 4; j++) {
          const p0 = V[j], p1 = V[(j + 1) % 4];
          expect(Math.min(Math.abs(p0.x - p1.x), Math.abs(p0.y - p1.y)), `${name} side ${j} level`).toBeLessThan(1e-6);
        }
      }
      // the one-repeat view still works on the polygon
      const w = wedgeView(L, n);
      expect(w).toBeTruthy();
      // hit testing, round lookup by the polygon's band
      const R = L.rounds[last - 1];
      const m = L.nodes.slice(R.first, R.last + 1).find((x) => x.kind === 'stitch')!;
      expect(hitTest(buildHitIndex(L), m.cx, m.cy)).toBe(m.id);
    }
  });
  it('every other corpus pattern and fixture stays as it was (no shape)', () => {
    const dirs = ['../../../../data/corpus/', '../../../../spec/fixtures/'];
    let n = 0;
    for (const d of dirs) {
      const dir = new URL(d, import.meta.url);
      for (const f of ['bobble-flower-coaster-6', 'petal-doily-12', 'picot-coaster-24', 'popcorn-ridge-mat-8', 'puff-star-coaster-5', 'rep-from-star-rosette-8',
        'solid-centre-lace-border-24', 'spiderweb-doily-10', 'spiral-sc-mat-fan-edge', 'sunburst-dtr-doily-20', 'teaching-cup-basket', 'teaching-ruffle-shell-doily',
        'uk-terms-wheel-16', 'wheel-mesh-centrepiece-8', 'chain_space_motif', 'flat_dc_circle', 'flat_sc_circle', 'hyperbolic_plane', 'sc_cone', 'sc_sphere', 'simple_doily']) {
        let text: string;
        try { text = readFileSync(new URL(`${f}.cro`, dir), 'utf8'); } catch { continue; }
        const p = compilePattern(text).pattern!;
        expect(layoutChart(p.graph, paramsFor(p)).shape, f).toBeUndefined();
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(20);
  });
  it('shapes: false draws the cornered motif as circles again (as before)', () => {
    const p = corpus('granny-square-motif');
    const L = layoutChart(p.graph, paramsFor(p), { shapes: false });
    expect(L.shape).toBeUndefined();
    expect(L.rounds.every((r) => !r.frame)).toBe(true);
  });
});
