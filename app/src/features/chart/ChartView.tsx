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
  bandPath, boundsUpto, buildHitIndex, cornerView, edgePath, glyph, hitTest, hullPath, layoutChart, magicRingGlyph, roundAt, symbolRoom, wedgeNote, wedgeView,
  POINTED_NOTE, type ChartLayout, type ScGlyph, type SymbolSet, type WedgeView,
} from '@/core/chart';
import { analyzeSymmetry, type SymmetryReport } from '@/core/symmetry';
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
  /**
   * 'all': the whole piece; 'arm': one repeat wedge enlarged (one arm of a snowflake, one repeat
   * of a doily, one side and corner of a polygon), "×n" noted, the rest ghosted — or, for a body in
   * rows with a border round it, the corner detail (one corner, the first rows, every border
   * round). Controlled when given; otherwise the view keeps its own state, starting on 'arm' for
   * pointed pieces (snowflakes) and for bordered swatches of some size on narrow screens.
   */
  view?: ChartViewMode;
  onViewChange?: (v: ChartViewMode) => void;
  /** Hide the Whole / One arm buttons. Default false. */
  hideViewControls?: boolean;
}

export type ChartViewMode = 'all' | 'arm';

/** Symbols are drawn at least this many screen pixels per chart unit (one sc wide), room permitting. */
const MIN_PX_PER_UNIT = 22;
/** On screens narrower than this a pointed chart opens on one arm, a bordered piece on its corner. */
const NARROW_PX = 600;
/** A bordered piece of at least this many stitches opens on its corner detail on a narrow screen. */
const CORNER_FIRST_NODES = 150;
/**
 * Above this many stitches the chart is not drawn (laying it out and drawing every symbol would
 * stall the page); a message says so. A full blanket of ~10 k stitches lays out in well under a
 * second, so this is far above any swatch.
 */
export const MAX_CHART_NODES = 40_000;

/** Short name of the one-repeat view of a chart (button and toggle labels). */
export function wedgeLabel(w: Pick<WedgeView, 'kind' | 'order'>): string {
  return w.kind === 'corner' ? 'Corner detail' : `${w.kind === 'arm' ? 'One arm' : 'One repeat'} ×${w.order}`;
}

/** Should this chart open on its arm / corner view (narrow screen)? */
export function preferWedge(layout: ChartLayout, width: number): boolean {
  if (!(width > 0 && width < NARROW_PX)) return false;
  if (layout.rounds.some((r) => r.pointed)) return true;
  return layout.shape?.kind === 'border' && layout.nodes.length >= CORNER_FIRST_NODES;
}

const symCache = new WeakMap<object, SymmetryReport | null>();
/** Memoised symmetry analysis of a pattern's graph (for the one-repeat view). */
export function chartSymmetry(pattern: Pattern): SymmetryReport | null {
  if (symCache.has(pattern.graph)) return symCache.get(pattern.graph)!;
  let r: SymmetryReport | null = null;
  try { r = analyzeSymmetry(pattern.graph); } catch { r = null; }
  symCache.set(pattern.graph, r);
  return r;
}

/**
 * The one-repeat wedge of a chart: centred on an arm (pointed pieces) or on the symmetry frame's
 * first repeat; null when the piece has no rotational symmetry (the view then stays whole).
 */
export function chartWedge(layout: ChartLayout, sym: SymmetryReport | null | undefined): WedgeView | null {
  if (layout.shape?.kind === 'border') return cornerView(layout);
  if (!sym || !sym.applicable || sym.order < 2 || layout.mode !== 'radial') return null;
  let axis: number | undefined;
  const f = sym.frame;
  if (f && f.elementNodes.length && f.sectors.length >= 1) {
    const L = f.elementNodes.length, p = L / sym.order;
    const ang = (id: number) => { const n = layout.nodes[id]; return n ? Math.atan2(-n.cy, n.cx) : 0; };
    const at = (x: number) => {
      const i0 = Math.floor(x), i1 = Math.ceil(x);
      const a = ang(f.elementNodes[((i0 % L) + L) % L]);
      if (i0 === i1) return a;
      const b = ang(f.elementNodes[((i1 % L) + L) % L]);
      return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
    };
    axis = at(f.sectors[0] + p / 2);
  }
  return wedgeView(layout, sym.order, { axis });
}

export function useChartWedge(pattern: Pattern, layout: ChartLayout): WedgeView | null {
  return useMemo(() => chartWedge(layout, chartSymmetry(pattern)), [pattern, layout]);
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

/** The chart, or — for a pattern too big to chart here — a message instead (the page stays responsive). */
export function ChartView(props: ChartViewProps) {
  const n = props.pattern.graph.nodes.length;
  if (!props.layout && n > MAX_CHART_NODES) return <ChartTooBig nodes={n} className={props.className} style={props.style} />;
  return <ChartViewInner {...props} />;
}

export function ChartTooBig({ nodes, className, style }: { nodes: number; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`ch-view ch-toobig${className ? ` ${className}` : ''}`} style={style} role="note">
      <p>
        <strong>Too big to chart here:</strong> {nodes.toLocaleString('en')} stitches and chains. A symbol chart is read a
        repeat at a time — chart a swatch or one motif instead (the blanket studio's swatch chart shows the stitch pattern
        and the border&apos;s corners).
      </p>
    </div>
  );
}

function ChartViewInner(props: ChartViewProps) {
  const {
    pattern, showFlatness = true, uptoRound, highlightNode, dimAfter, onNodeClick, className, style,
    showLabels = true, symbolSet = 'cyc', scGlyph = 'x', onRoundClick, symmetryOverlay, emphasisNodes, hideViewControls,
  } = props;
  const settingsTerms = useSettings((s) => s.terms);
  const terms = props.terms ?? settingsTerms;
  const params = props.params ?? paramsFor(pattern);
  const computed = useChartLayout(pattern, params);
  const full = props.layout ?? computed;
  const graph = pattern.graph;
  const wedge = useChartWedge(pattern, full);

  // ---- whole / one-arm view (controlled or own state)
  const rootRef = useRef<HTMLDivElement>(null);
  const [ownView, setOwnView] = useState<ChartViewMode | null>(null);
  useLayoutEffect(() => {
    if (ownView !== null) return;
    const w = typeof window !== 'undefined' ? window.innerWidth : 1000;
    setOwnView(preferWedge(full, w) && highlightNode === undefined ? 'arm' : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);
  const mode: ChartViewMode = (props.view ?? ownView ?? 'all') === 'arm' && wedge ? 'arm' : 'all';
  const setMode = (v: ChartViewMode) => { if (props.view === undefined) setOwnView(v); props.onViewChange?.(v); };
  const W8 = mode === 'arm' ? wedge : null;
  const layout = W8 ? W8.layout : full;
  const lastRound = layout.rounds.length - 1;
  const upto = uptoRound === undefined ? lastRound : Math.max(0, Math.min(lastRound, uptoRound));
  const lastNode = useMemo(() => {
    for (let r = upto; r >= 0; r--) if (layout.rounds[r]?.last >= 0) return layout.rounds[r].last;
    return -1;
  }, [layout, upto]);

  // ---- symbol size: marks grow when the chart is shown small (screen px per chart unit at the
  // current zoom), never past the room the layout leaves between symbols
  const room = useMemo(() => symbolRoom(layout, W8 ? W8.inside : undefined), [layout, W8]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBox((b) => (Math.abs(b.w - el.clientWidth) < 2 && Math.abs(b.h - el.clientHeight) < 2 ? b : { w: el.clientWidth, h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [zoomQ, setZoomQ] = useState(1);
  // (a strip below the chart for the view buttons)
  const barStrip = !hideViewControls && !!wedge;
  const vb0 = useMemo(() => {
    const b = W8 ? { ...W8.bounds } : boundsUpto(layout, upto, 0.7);
    if (barStrip) b.maxY += W8 ? 1.3 : 0.09 * (b.maxY - b.minY);
    return b;
  }, [W8, layout, upto, barStrip]);
  const fitPx = box.w > 0 ? Math.min(box.w / (vb0.maxX - vb0.minX), box.h > 0 ? box.h / (vb0.maxY - vb0.minY) : Infinity) : 0;
  const want = fitPx > 0 ? MIN_PX_PER_UNIT / (fitPx * zoomQ) : 1;
  const markK = Math.round(Math.max(1, Math.min(room, want)) * 10) / 10;
  // lines thicken a little more than the marks grow (thicker strokes do not collide)
  const strokeK = Math.round(Math.max(1, Math.min(1.5, want)) * 10) / 10;

  // ---- symbol path data, per node (memoised per layout + symbol options)
  const glyphs = useMemo(() => {
    const o = { set: symbolSet, sc: scGlyph, scale: markK };
    const stroke: string[] = new Array(layout.nodes.length);
    const fill: string[] = new Array(layout.nodes.length);
    for (const n of layout.nodes) { const g = glyph(n, o); stroke[n.id] = g.stroke; fill[n.id] = g.fill; }
    return { stroke, fill };
  }, [layout, symbolSet, scGlyph, markK]);

  const chunks = useMemo(() => {
    const out: { round: number; from: number; to: number }[] = [];
    for (const r of layout.rounds) {
      if (r.first < 0) continue;
      for (let a = r.first; a <= r.last; a += CHUNK) out.push({ round: r.index, from: a, to: Math.min(r.last, a + CHUNK - 1) });
    }
    return out;
  }, [layout]);

  const bands = useMemo(() => {
    if (layout.mode !== 'radial') {
      // a body in rows: only its border rounds have a band (edge fit + corner rule), and only with the flatness band on
      return layout.rounds.filter((r) => r.border && r.frame && r.first >= 0 && r.flat && r.flat.class !== 'n/a').map((r) => ({
        index: r.index, d: bandPath(layout, r.index), edge: r.flat!.class !== 'flat' ? edgePath(r) : '',
        cls: r.flat!.class, message: r.flat!.message, loose: false,
      }));
    }
    return layout.rounds.filter((r) => r.first >= 0 && (r.r > r.r0 || r.pointed)).map((r) => (r.pointed
      // a pointed round is judged by blocking: no tint (a filled star reads as a flower), only the
      // faint dashed outline it is pinned out to (tips and valley pins)
      ? { index: r.index, d: '', edge: W8 ? wedgeHull(r.hull ?? [], W8.half) : hullPath(r), cls: 'pointed', message: POINTED_NOTE, loose: false }
      : {
        index: r.index, d: bandPath(layout, r.index), edge: r.flat && r.flat.class !== 'flat' && r.flat.class !== 'n/a' ? edgePath(r) : '',
        cls: r.flat?.class ?? 'n/a', message: r.flat?.message ?? '', loose: !!r.flat?.slackOnly,
      }));
  }, [layout, W8]);

  const symGeo = useMemo(() => (W8 ? null : symmetryGeometry(layout, symmetryOverlay, upto)), [W8, layout, symmetryOverlay, upto]);
  const emph = useMemo(() => (emphasisNodes ?? []).filter((id) => id >= 0 && id <= lastNode).map((id) => layout.nodes[id]).filter(Boolean), [emphasisNodes, lastNode, layout]);

  const hitIndex = useMemo(() => buildHitIndex(layout), [layout]);
  const vb = vb0;
  const vbW = vb.maxX - vb.minX, vbH = vb.maxY - vb.minY;

  // ---- pan / zoom (imperative)
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const [zoomed, setZoomed] = useState(false);
  const applyView = useCallback(() => {
    const v = view.current;
    gRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);
    const z = Math.abs(v.k - 1) > 1e-3 || Math.abs(v.x) > 1e-3 || Math.abs(v.y) > 1e-3;
    setZoomed((p) => (p === z ? p : z));
    // symbol size follows the zoom in steps (re-drawing glyphs per frame would be wasteful)
    const q = Math.pow(1.25, Math.round(Math.log(v.k) / Math.log(1.25)));
    setZoomQ((p) => (Math.abs(p - q) < 1e-6 ? p : q));
  }, []);
  const reset = useCallback(() => { view.current = { k: 1, x: 0, y: 0 }; applyView(); }, [applyView]);
  useLayoutEffect(() => { reset(); }, [layout, reset, mode]);

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
      const lines = [R?.pointed ? `${R.label}: ${POINTED_NOTE}` : showFlatness && R?.flat && R.flat.class !== 'n/a' ? R.flat.message : R?.label ?? ''];
      return { tip: { ...at, title: describeNode(graph, id, { terms }), lines, pinned }, node: id, round: n.round };
    }
    const r = roundAt(layout, c.x, c.y, upto);
    if (r >= 0) {
      const R = layout.rounds[r];
      const msg = R.pointed ? `Pointed round — judged by blocking, not by the flatness rule` : showFlatness && R.flat && R.flat.class !== 'n/a' ? R.flat.message : '';
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
  const showBar = !hideViewControls && !!wedge;

  return (
    <div
      ref={rootRef}
      className={`ch-view${zoomed ? ' is-zoomed' : ''}${W8 ? ' is-arm' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, ['--ch-ar' as string]: `${vbW} / ${vbH}`, ['--ch-sw' as string]: String(Math.round(0.065 * strokeK * 1000) / 1000) }}
      data-view={mode}
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
          <Bands bands={bands} upto={upto} flatness={showFlatness} hatchId={hatchId} rowsMode={layout.mode !== 'radial'} />
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
                level={W8?.inside}
              />
            );
          })}
          {showLabels && (W8
            ? <g className="ch-labels" aria-hidden="true">{W8.labels.map((l, i) => <text key={i} x={l.x} y={l.y}>{l.text}</text>)}</g>
            : <Labels layout={layout} upto={upto} />)}
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
      {showBar && (
        <div className="ch-viewbar" role="group" aria-label="Chart view">
          <button type="button" aria-pressed={mode === 'all'} onClick={() => { setMode('all'); setTip(null); }} title="Fit the whole piece">
            Whole
          </button>
          <button type="button" aria-pressed={mode === 'arm'} onClick={() => { setMode('arm'); setTip(null); }} title={wedge!.kind === 'corner' ? 'One corner of the border with the first rows, enlarged (all four corners are worked alike)' : `Fit one repeat, enlarged (the piece is ${wedge!.order}-fold)`}>
            {wedgeLabel(wedge!)}
          </button>
        </div>
      )}
      {W8 && !showBar && <p className="ch-viewnote">{wedgeNote(W8)}</p>}
      {zoomed && (
        <button type="button" className="ch-reset" onClick={() => { reset(); setTip(null); }} aria-label={W8 ? (W8.kind === 'corner' ? 'Fit the corner' : 'Fit the arm') : 'Fit the whole chart'}>
          {W8 ? (W8.kind === 'arm' ? 'Fit arm' : W8.kind === 'corner' ? 'Fit corner' : 'Fit repeat') : 'Fit all'}
        </button>
      )}
    </div>
  );
}
export default ChartView;

/** One-repeat view: the part of a pointed round's outline next to the arm (pointing up), open. */
function wedgeHull(h: { x: number; y: number }[], half: number): string {
  const near = (p: { x: number; y: number }) => Math.abs(Math.atan2(-p.y, p.x) - Math.PI / 2) <= half * 1.15 + 1e-6;
  const pts = h.filter(near).sort((a, b) => Math.atan2(-b.y, b.x) - Math.atan2(-a.y, a.x));
  if (pts.length < 2) return '';
  return `M${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('L')}`;
}

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

const Chunk = memo(function Chunk({ stroke, fill, from, to, alt, state, cut, level }: {
  stroke: string[]; fill: string[]; from: number; to: number; alt: boolean; state: 'done' | 'todo' | 'split'; cut: number;
  /** One-repeat view: 2 = the repeat, 1 = context (half-tone), 0 = ghosted. */
  level?: Uint8Array;
}) {
  const part = (a: number, b: number, cls: string, key: string) => {
    if (!level) {
      let s = '', f = '';
      for (let i = a; i <= b; i++) { s += stroke[i]; f += fill[i]; }
      return (
        <g key={key} className={cls}>
          {s && <path d={s} />}
          {f && <path className="f" d={f} />}
        </g>
      );
    }
    const S = ['', '', ''], F = ['', '', ''];
    for (let i = a; i <= b; i++) { const l = level[i] ?? 0; S[l] += stroke[i]; F[l] += fill[i]; }
    return (
      <g key={key} className={cls}>
        {[2, 1, 0].map((l) => (S[l] || F[l]) && (
          <g key={l} className={l === 2 ? undefined : l === 1 ? 'ch-ctx' : 'ch-ghost'}>
            {S[l] && <path d={S[l]} />}
            {F[l] && <path className="f" d={F[l]} />}
          </g>
        ))}
      </g>
    );
  };
  const base = `ch-sym${alt ? ' ch-alt' : ''}`;
  if (state === 'split') {
    return <>{part(from, cut, base, 'a')}{cut < to && part(cut + 1, to, `${base} ch-dim`, 'b')}</>;
  }
  return part(from, to, state === 'todo' ? `${base} ch-dim` : base, 'a');
});

const Bands = memo(function Bands({ bands, upto, flatness, hatchId, rowsMode }: {
  bands: { index: number; d: string; edge: string; cls: string; message: string; loose: boolean }[]; upto: number; flatness: boolean; hatchId: string; rowsMode?: boolean;
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
        if (b.cls === 'pointed') {
          return b.edge ? <path key={b.index} className="ch-hull" d={b.edge}><title>{b.message}</title></path> : null;
        }
        const shape = flatness && b.cls !== 'n/a' ? b.cls : '';
        if (!shape && (b.index % 2 === 0 || rowsMode)) return null;
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
