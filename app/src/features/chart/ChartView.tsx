/**
 * Radial symbol chart of a pattern (SVG). Other features embed the chart only through this
 * component and these props; the layout itself is the pure `layoutChart` in `@/core/chart`.
 *
 * Performance: the layout and every symbol's path data are memoised per pattern; symbols are drawn
 * as a few concatenated paths per chunk of ≤ 120 nodes, so moving `highlightNode` re-renders one or
 * two chunks. Pan / zoom writes the transform straight to the DOM (no React state per frame);
 * hit testing uses a grid index, so there are no per-node elements or listeners.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Pattern, Terms } from '@/core/graph';
import { describeNode } from '@/core/graph';
import { paramsFor, type ParamSet } from '@/core/params';
import {
  bandPath, boundsUpto, buildHitIndex, edgePath, glyph, hitTest, layoutChart, magicRingGlyph, roundAt,
  type ChartLayout, type ScGlyph, type SymbolSet,
} from '@/core/chart';
import type { SymmetryReport } from '@/core/symmetry';
import { useSettings } from '@/store/settings';
import './chart.css';

export interface ChartViewProps {
  pattern: Pattern;
  /** Parameter set used for layout proportions and the flatness band. Default: paramsFor(pattern). */
  params?: ParamSet;
  /** Draw the per-round flat / cup / ruffle colour band. Default true. */
  showFlatness?: boolean;
  /** Draw only rounds 0..uptoRound (index into graph.rounds). Default: all. */
  uptoRound?: number;
  /** Node to emphasise (the counter's current stitch). Nodes before it are drawn as done when `dimAfter` is set. */
  highlightNode?: number;
  /** Fade nodes after highlightNode (work not yet done). */
  dimAfter?: boolean;
  onNodeClick?: (nodeId: number) => void;
  className?: string;
  style?: React.CSSProperties;
  // ---- optional additions (chart feature) ----
  /** Round number labels at the start of each round. Default true. */
  showLabels?: boolean;
  /** 'cyc' (default) or 'jis' symbol conventions. */
  symbolSet?: SymbolSet;
  /** Single crochet drawn as '×' (default) or '+'. */
  scGlyph?: ScGlyph;
  /** Terms for tooltips. Default: the app setting. */
  terms?: Terms;
  /** A precomputed layout (must be of this pattern); saves recomputing it. */
  layout?: ChartLayout;
  /** Called when a round band (not a symbol) is tapped. */
  onRoundClick?: (round: number) => void;
  /** Accessible name. Default: "Symbol chart of <title>". */
  ariaLabel?: string;
  /**
   * Symmetry overlay (radial charts): the n sector lines, ONE repeat wedge shaded (the unit that is
   * repeated), and mirror axes as dashed lines when the piece is dihedral. From `analyzeSymmetry`.
   */
  symmetryOverlay?: SymmetryReport | null;
  /** Nodes to emphasise with a ring (e.g. the stitches that break a repeat). */
  emphasisNodes?: number[];
}

const CHUNK = 120;
const layoutCache = new WeakMap<object, Map<string, ChartLayout>>();

/** Memoised layout for a pattern + parameter set (shared by every view of the same graph). */
export function getChartLayout(pattern: Pattern, params: ParamSet): ChartLayout {
  let m = layoutCache.get(pattern.graph);
  if (!m) { m = new Map(); layoutCache.set(pattern.graph, m); }
  let l = m.get(params.id);
  if (!l) { l = layoutChart(pattern.graph, params); m.set(params.id, l); }
  return l;
}

export function useChartLayout(pattern: Pattern, params?: ParamSet): ChartLayout {
  const p = params ?? paramsFor(pattern);
  return useMemo(() => getChartLayout(pattern, p), [pattern, p]);
}

type Tip = { x: number; y: number; title: string; lines: string[]; pinned: boolean };
type View = { k: number; x: number; y: number };

export function ChartView(props: ChartViewProps) {
  const {
    pattern, showFlatness = true, uptoRound, highlightNode, dimAfter, onNodeClick, className, style,
    showLabels = true, symbolSet = 'cyc', scGlyph = 'x', onRoundClick, symmetryOverlay, emphasisNodes,
  } = props;
  const settingsTerms = useSettings((s) => s.terms);
  const terms = props.terms ?? settingsTerms;
  const params = props.params ?? paramsFor(pattern);
  const computed = useChartLayout(pattern, params);
  const layout = props.layout ?? computed;
  const graph = pattern.graph;
  const lastRound = layout.rounds.length - 1;
  const upto = uptoRound === undefined ? lastRound : Math.max(0, Math.min(lastRound, uptoRound));
  const lastNode = useMemo(() => {
    for (let r = upto; r >= 0; r--) if (layout.rounds[r]?.last >= 0) return layout.rounds[r].last;
    return -1;
  }, [layout, upto]);

  // ---- symbol path data, per node (memoised per layout + symbol options)
  const glyphs = useMemo(() => {
    const o = { set: symbolSet, sc: scGlyph };
    const stroke: string[] = new Array(layout.nodes.length);
    const fill: string[] = new Array(layout.nodes.length);
    for (const n of layout.nodes) { const g = glyph(n, o); stroke[n.id] = g.stroke; fill[n.id] = g.fill; }
    return { stroke, fill };
  }, [layout, symbolSet, scGlyph]);

  const chunks = useMemo(() => {
    const out: { round: number; from: number; to: number }[] = [];
    for (const r of layout.rounds) {
      if (r.first < 0) continue;
      for (let a = r.first; a <= r.last; a += CHUNK) out.push({ round: r.index, from: a, to: Math.min(r.last, a + CHUNK - 1) });
    }
    return out;
  }, [layout]);

  const bands = useMemo(() => {
    if (layout.mode !== 'radial') return [];
    return layout.rounds.filter((r) => r.first >= 0 && r.r > r.r0).map((r) => ({
      index: r.index, d: bandPath(layout, r.index), edge: r.flat && r.flat.class !== 'flat' && r.flat.class !== 'n/a' ? edgePath(r) : '',
      cls: r.flat?.class ?? 'n/a', message: r.flat?.message ?? '', loose: !!r.flat?.slackOnly,
    }));
  }, [layout]);

  const symGeo = useMemo(() => symmetryGeometry(layout, symmetryOverlay, upto), [layout, symmetryOverlay, upto]);
  const emph = useMemo(() => (emphasisNodes ?? []).filter((id) => id >= 0 && id <= lastNode).map((id) => layout.nodes[id]).filter(Boolean), [emphasisNodes, lastNode, layout]);

  const hitIndex = useMemo(() => buildHitIndex(layout), [layout]);
  const vb = useMemo(() => boundsUpto(layout, upto, 0.7), [layout, upto]);
  const vbW = vb.maxX - vb.minX, vbH = vb.maxY - vb.minY;

  // ---- pan / zoom (imperative)
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const [zoomed, setZoomed] = useState(false);
  const applyView = useCallback(() => {
    const v = view.current;
    gRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);
    const z = Math.abs(v.k - 1) > 1e-3 || Math.abs(v.x) > 1e-3 || Math.abs(v.y) > 1e-3;
    setZoomed((p) => (p === z ? p : z));
  }, []);
  const reset = useCallback(() => { view.current = { k: 1, x: 0, y: 0 }; applyView(); }, [applyView]);
  useLayoutEffect(() => { reset(); }, [layout, reset]);

  const toUser = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const toChart = (clientX: number, clientY: number) => {
    const u = toUser(clientX, clientY);
    const v = view.current;
    return { x: (u.x - v.x) / v.k, y: (u.y - v.y) / v.k };
  };
  const zoomAt = useCallback((ux: number, uy: number, factor: number) => {
    const v = view.current;
    const k = Math.min(40, Math.max(0.5, v.k * factor));
    const f = k / v.k;
    view.current = { k, x: ux - (ux - v.x) * f, y: uy - (uy - v.y) * f };
    applyView();
  }, [applyView]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(p.x, p.y, Math.exp(-dy * 0.0018));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- tooltip
  const [tip, setTip] = useState<Tip | null>(null);
  const hatchId = `ch-hatch${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const tipFor = useCallback((clientX: number, clientY: number, pinned: boolean): { tip: Tip | null; node: number; round: number } => {
    const root = rootRef.current;
    if (!root) return { tip: null, node: -1, round: -1 };
    const c = toChart(clientX, clientY);
    const rect = root.getBoundingClientRect();
    const scale = (svgRef.current?.getScreenCTM()?.a ?? 1) * view.current.k; // px per chart unit
    const reach = Math.max(0.45, Math.min(1.2, 22 / Math.max(scale, 1e-6)));
    const id = hitTest(hitIndex, c.x, c.y, reach, upto);
    const at = { x: clientX - rect.left, y: clientY - rect.top };
    if (id >= 0) {
      const n = graph.nodes[id];
      const R = layout.rounds[n.round];
      const lines = [showFlatness && R?.flat && R.flat.class !== 'n/a' ? R.flat.message : R?.label ?? ''];
      return { tip: { ...at, title: describeNode(graph, id, { terms }), lines, pinned }, node: id, round: n.round };
    }
    const r = roundAt(layout, c.x, c.y, upto);
    if (r >= 0) {
      const R = layout.rounds[r];
      const msg = showFlatness && R.flat && R.flat.class !== 'n/a' ? R.flat.message : '';
      return { tip: { ...at, title: R.label, lines: msg ? [msg] : [], pinned }, node: -1, round: r };
    }
    return { tip: null, node: -1, round: -1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitIndex, graph, layout, terms, upto, showFlatness]);

  // ---- pointers: drag to pan, two fingers to pinch, tap / double tap
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; lastTap: number; lastTapX: number; lastTapY: number; pinchD: number }>(
    { moved: false, startX: 0, startY: 0, lastTap: 0, lastTapX: 0, lastTapY: 0, pinchD: 0 },
  );
  const hoverRaf = useRef(0);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const g = gesture.current;
    if (pointers.current.size === 1) { g.moved = false; g.startX = e.clientX; g.startY = e.clientY; }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      g.moved = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const P = pointers.current;
    const prev = P.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse' && !tip?.pinned) {
        const { clientX, clientY } = e;
        cancelAnimationFrame(hoverRaf.current);
        hoverRaf.current = requestAnimationFrame(() => {
          const t = tipFor(clientX, clientY, false).tip;
          setTip((old) => (old?.title === t?.title && old?.lines[0] === t?.lines[0] && old && t ? { ...t } : t));
        });
      }
      return;
    }
    const g = gesture.current;
    if (P.size === 1) {
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 6) return;
      g.moved = true;
      const a = toUser(prev.x, prev.y), b = toUser(e.clientX, e.clientY);
      view.current = { ...view.current, x: view.current.x + b.x - a.x, y: view.current.y + b.y - a.y };
      applyView();
      setTip(null);
    } else if (P.size === 2) {
      const others = [...P.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
      const o = others[0];
      const d = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      const midPrev = toUser((prev.x + o.x) / 2, (prev.y + o.y) / 2);
      const mid = toUser((e.clientX + o.x) / 2, (e.clientY + o.y) / 2);
      if (g.pinchD > 0) zoomAt(midPrev.x, midPrev.y, d / g.pinchD);
      view.current = { ...view.current, x: view.current.x + mid.x - midPrev.x, y: view.current.y + mid.y - midPrev.y };
      applyView();
      g.pinchD = d;
    }
    P.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const P = pointers.current;
    if (!P.has(e.pointerId)) return;
    P.delete(e.pointerId);
    const g = gesture.current;
    if (P.size > 0 || g.moved) { if (P.size === 0) g.moved = false; return; }
    // a tap
    const now = performance.now();
    if (now - g.lastTap < 320 && Math.hypot(e.clientX - g.lastTapX, e.clientY - g.lastTapY) < 30) {
      g.lastTap = 0;
      reset();
      setTip(null);
      return;
    }
    g.lastTap = now; g.lastTapX = e.clientX; g.lastTapY = e.clientY;
    const hit = tipFor(e.clientX, e.clientY, e.pointerType !== 'mouse');
    setTip(hit.tip);
    if (hit.node >= 0) onNodeClick?.(hit.node);
    else if (hit.round >= 0) onRoundClick?.(hit.round);
  };
  const onPointerCancel = (e: React.PointerEvent<SVGSVGElement>) => { pointers.current.delete(e.pointerId); gesture.current.moved = false; };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cx = vb.minX + vbW / 2, cy = vb.minY + vbH / 2;
    const step = Math.min(vbW, vbH) * 0.08;
    const pan = (dx: number, dy: number) => { view.current = { ...view.current, x: view.current.x + dx, y: view.current.y + dy }; applyView(); };
    switch (e.key) {
      case '+': case '=': zoomAt(cx, cy, 1.25); break;
      case '-': case '_': zoomAt(cx, cy, 0.8); break;
      case '0': reset(); break;
      case 'ArrowLeft': pan(step, 0); break;
      case 'ArrowRight': pan(-step, 0); break;
      case 'ArrowUp': pan(0, step); break;
      case 'ArrowDown': pan(0, -step); break;
      case 'Escape': setTip(null); return;
      default: return;
    }
    e.preventDefault();
  };

  useEffect(() => { setTip(null); }, [pattern, upto]);

  // ---- render
  const hl = highlightNode !== undefined && highlightNode >= 0 && highlightNode <= lastNode ? layout.nodes[highlightNode] : undefined;
  const hlGlyph = useMemo(() => (hl ? glyph(hl, { set: symbolSet, sc: scGlyph }) : null), [hl, symbolSet, scGlyph]);
  const cut = dimAfter && hl ? hl.id : undefined;
  const title = props.ariaLabel ?? `Symbol chart of ${pattern.meta.title || 'the pattern'}`;
  const ring = layout.ring?.kind === 'magic' ? magicRingGlyph(layout.ring.r) : null;

  return (
    <div
      ref={rootRef}
      className={`ch-view${zoomed ? ' is-zoomed' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, ['--ch-ar' as string]: `${vbW} / ${vbH}` }}
      tabIndex={0}
      role="group"
      aria-label={`${title}. Drag to pan, pinch or scroll to zoom, double-tap to reset; keys + − 0 and arrows.`}
      onKeyDown={onKeyDown}
    >
      <svg
        ref={svgRef}
        className="ch-svg"
        viewBox={`${vb.minX} ${vb.minY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !tip?.pinned) setTip(null); }}
        onDoubleClick={() => { reset(); setTip(null); }}
      >
        <g ref={gRef}>
          <Bands bands={bands} upto={upto} flatness={showFlatness} hatchId={hatchId} />
          {symGeo && (
            <g className="ch-symov" aria-hidden="true">
              {symGeo.wedge && <path className="ch-symov__wedge" d={symGeo.wedge} />}
              {symGeo.sectors.map((l, i) => <line key={`s${i}`} className={`ch-symov__sector${i < 2 && symGeo.wedge ? ' is-edge' : ''}`} x1={0} y1={0} x2={l.x} y2={l.y} />)}
              {symGeo.axes.map((l, i) => <line key={`a${i}`} className="ch-symov__axis" x1={0} y1={0} x2={l.x} y2={l.y} />)}
            </g>
          )}
          {ring && <path className="ch-ring" d={ring.stroke} />}
          {chunks.map((c) => {
            if (c.round > upto) return null;
            const state = cut === undefined || c.to <= cut ? 'done' : c.from > cut ? 'todo' : 'split';
            return (
              <Chunk
                key={c.from}
                stroke={glyphs.stroke}
                fill={glyphs.fill}
                from={c.from}
                to={c.to}
                alt={c.round % 2 === 1}
                state={state}
                cut={state === 'split' ? cut! : -1}
              />
            );
          })}
          {showLabels && <Labels layout={layout} upto={upto} />}
          {emph.length > 0 && (
            <g className="ch-emph" aria-hidden="true">
              {emph.map((n) => <circle key={n.id} cx={n.cx} cy={n.cy} r={0.8} />)}
            </g>
          )}
          {hl && hlGlyph && (
            <g className="ch-hl" aria-hidden="true">
              <circle cx={hl.cx} cy={hl.cy} r={0.62} />
              {hlGlyph.stroke && <path d={hlGlyph.stroke} />}
              {hlGlyph.fill && <path className="f" d={hlGlyph.fill} />}
            </g>
          )}
        </g>
      </svg>
      {tip && (
        <div
          className="ch-tip"
          role="status"
          style={{ left: Math.max(8, Math.min(tip.x, (rootRef.current?.clientWidth ?? 300) - 8)), top: tip.y }}
        >
          <strong>{tip.title}</strong>
          {tip.lines.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}
      {zoomed && (
        <button type="button" className="ch-reset" onClick={() => { reset(); setTip(null); }} aria-label="Reset zoom">
          Reset view
        </button>
      )}
    </div>
  );
}
export default ChartView;

/** Lines and the shaded repeat of a symmetry overlay, in chart coordinates (centre at 0,0). */
function symmetryGeometry(layout: ChartLayout, sym: SymmetryReport | null | undefined, upto: number) {
  const f = sym?.frame;
  if (!sym || !f || layout.mode !== 'radial' || sym.order < 1 || !f.elementNodes.length) return null;
  const L = f.elementNodes.length;
  const ang = (id: number) => { const n = layout.nodes[id]; return n ? Math.atan2(n.cy, n.cx) : 0; };
  const at = (x: number) => {
    const i0 = Math.floor(x), i1 = Math.ceil(x);
    const a = ang(f.elementNodes[((i0 % L) + L) % L]);
    if (i0 === i1) return a;
    const b = ang(f.elementNodes[((i1 % L) + L) % L]);
    return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
  };
  let R = 0;
  for (const r of layout.rounds) if (r.index <= upto && r.first >= 0) R = Math.max(R, r.rOuter);
  R += 0.8;
  const pt = (a: number) => ({ x: R * Math.cos(a), y: R * Math.sin(a) });
  const sectors = sym.order > 1 ? f.sectors.map((x) => pt(at(x))) : [];
  const axes = f.axes.map((x) => pt(at(x)));
  let wedge = '';
  if (sym.order > 1) {
    const p = L / sym.order;
    const a0 = at(f.sectors[0]), a1 = at(f.sectors[1]), am = at(f.sectors[0] + p / 2);
    const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const d1 = norm(a1 - a0), dm = norm(am - a0);
    const pos = dm < d1;
    const span = pos ? d1 : 2 * Math.PI - d1;
    const s0 = pt(a0), s1 = pt(a1);
    wedge = `M0 0L${s0.x.toFixed(3)} ${s0.y.toFixed(3)}A${R.toFixed(3)} ${R.toFixed(3)} 0 ${span > Math.PI ? 1 : 0} ${pos ? 1 : 0} ${s1.x.toFixed(3)} ${s1.y.toFixed(3)}Z`;
  }
  return { sectors, axes, wedge };
}

const Chunk = memo(function Chunk({ stroke, fill, from, to, alt, state, cut }: {
  stroke: string[]; fill: string[]; from: number; to: number; alt: boolean; state: 'done' | 'todo' | 'split'; cut: number;
}) {
  const part = (a: number, b: number, cls: string, key: string) => {
    let s = '', f = '';
    for (let i = a; i <= b; i++) { s += stroke[i]; f += fill[i]; }
    return (
      <g key={key} className={cls}>
        {s && <path d={s} />}
        {f && <path className="f" d={f} />}
      </g>
    );
  };
  const base = `ch-sym${alt ? ' ch-alt' : ''}`;
  if (state === 'split') {
    return <>{part(from, cut, base, 'a')}{cut < to && part(cut + 1, to, `${base} ch-dim`, 'b')}</>;
  }
  return part(from, to, state === 'todo' ? `${base} ch-dim` : base, 'a');
});

const Bands = memo(function Bands({ bands, upto, flatness, hatchId }: {
  bands: { index: number; d: string; edge: string; cls: string; message: string; loose: boolean }[]; upto: number; flatness: boolean; hatchId: string;
}) {
  const anyLoose = flatness && bands.some((b) => b.loose && b.index <= upto);
  return (
    <g className="ch-bands">
      {anyLoose && (
        <defs>
          {/* "flat (loose loops)": flat only if the chain loops take up the slack (flatness.md) */}
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="0.32" height="0.32" patternTransform="rotate(45)">
            <rect className="ch-hatch-bg" width="0.32" height="0.32" />
            <line className="ch-hatch-line" x1="0" y1="0" x2="0" y2="0.32" />
          </pattern>
        </defs>
      )}
      {bands.map((b) => {
        if (b.index > upto) return null;
        const shape = flatness && b.cls !== 'n/a' ? b.cls : '';
        if (!shape && b.index % 2 === 0) return null;
        return (
          <g key={b.index}>
            <path className={shape ? `ch-band ch-band--${shape}${b.index % 2 ? ' ch-band--odd' : ''}` : 'ch-band ch-band--alt'} d={b.d} fillRule="evenodd" />
            {shape === 'flat' && b.loose && <path className="ch-band ch-band--loose" d={b.d} fillRule="evenodd" fill={`url(#${hatchId})`} />}
            {shape && b.edge && <path className={`ch-edge ch-edge--${shape}`} d={b.edge} />}
          </g>
        );
      })}
    </g>
  );
});

const Labels = memo(function Labels({ layout, upto }: { layout: ChartLayout; upto: number }) {
  return (
    <g className="ch-labels" aria-hidden="true">
      {layout.rounds.map((r) => (r.first < 0 || r.index > upto ? null : (
        <text key={r.index} x={r.labelAt.x} y={r.labelAt.y}>{r.short}</text>
      )))}
    </g>
  );
});
