/**
 * Blanket swatches on the chart page, from a link (no library record):
 *
 *   #/chart?blanket=rect:<body pattern>:<border layers>      e.g. rect:dc:sc,shell   rect:moss:sc
 *   #/chart?blanket=round:<style>:<textures>                 e.g. round:granny-square:granny
 *   #/chart?blanket=demo:<demo id>                           an example design of the studio
 *
 * Options: `&full=1` charts the whole blanket instead of the swatch (when it compiles), `&w=<cm>`
 * sets the width (a small whole blanket: `round:circle-to-square:dc,hdc&full=1&w=30`).
 * The swatch is the studio's own (designBlanket): the same text, the same parameter set.
 */
import { DEFAULT_SPEC, ROUND_STYLE_BY_ID, STITCH_BY_ID, BORDERS, designBlanket, type BlanketSpec, type BorderKind } from '@/core/blanket';
import type { Pattern } from '@/core/graph';
import type { ParamSet } from '@/core/params';
import { DEMO_BY_ID } from '@/features/blanket/demos';

export interface SwatchChart { pattern: Pattern; title: string; params: ParamSet }

const KINDS = new Set(BORDERS.map((b) => b.kind));

/** The blanket spec a `blanket=` link describes, or null. */
export function specFromQuery(q: URLSearchParams): BlanketSpec | null {
  const v = q.get('blanket') ?? '';
  const [kind, a = '', b = ''] = v.split(':');
  const list = b.split(',').map((x) => x.trim()).filter(Boolean);
  const w = Number(q.get('w'));
  const size = Number.isFinite(w) && w >= 10 && w <= 300 ? { widthCm: w, heightCm: w } : undefined;
  if (kind === 'demo') {
    const d = DEMO_BY_ID[a];
    return d ? { ...d.spec, ...(size ? { size } : {}) } : null;
  }
  if (kind === 'rect') {
    if (!STITCH_BY_ID[a] || !list.every((k) => KINDS.has(k as BorderKind))) return null;
    return {
      ...DEFAULT_SPEC, construction: 'rect', body: { pattern: a }, ...(size ? { size } : {}),
      border: { enabled: true, rowEnds: 'auto', edgeCorner: 'sc3', edgeColor: 'E', layers: list.map((k) => ({ kind: k as BorderKind, color: 'A' })) },
    };
  }
  if (kind === 'round') {
    const style = ROUND_STYLE_BY_ID[a as keyof typeof ROUND_STYLE_BY_ID];
    if (!style) return null;
    const textures = (list.length ? list : style.defaultTextures).filter((k) => KINDS.has(k as BorderKind)) as BorderKind[];
    return {
      ...DEFAULT_SPEC, construction: 'round', size: size ?? { widthCm: 90, heightCm: 90 },
      round: { style: style.id, textures: textures.length ? textures : style.defaultTextures, corner: 'auto' },
    };
  }
  return null;
}

export function swatchFromQuery(q: URLSearchParams): SwatchChart | null {
  const spec = specFromQuery(q);
  if (!spec) return null;
  const full = q.get('full') === '1';
  try {
    const d = designBlanket(spec, undefined, { fullLimit: full ? 30_000 : 0 });
    const pattern = full && d.pattern ? d.pattern : d.swatch;
    if (!pattern) return null;
    return { pattern, title: pattern.meta.title, params: d.params };
  } catch {
    return null;
  }
}
