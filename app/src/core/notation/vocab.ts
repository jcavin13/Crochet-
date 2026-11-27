/**
 * Stitch vocabulary, loaded from spec/stitches.json, and the US/UK dialect tables built from it.
 *
 * The parser asks two questions of a single word: "which base stitch is this in the current
 * terms?" (baseFromWord) and, when that fails, "is it a known word of the *other* dialect or a
 * near miss?" (unknownStitchHint). The printer asks the inverse (nameOf).
 */
import stitchesJson from '@spec/stitches.json';
import type { StitchType, Terms } from '../graph/types';
import type { BaseType } from './ast';

interface StitchDef {
  id: StitchType;
  name: string;
  us: string[];
  uk: string[];
  tch: number;
  counts: boolean;
  anchors: number;
}

const DEFS: StitchDef[] = (stitchesJson as unknown as { types: StitchDef[] }).types;
const BY_ID = new Map<StitchType, StitchDef>(DEFS.map((d) => [d.id, d]));

export const BASE_TYPES: readonly BaseType[] = ['sc', 'hdc', 'dc', 'tr', 'dtr'];

/** tch height (turning chains equal to the stitch height) from stitches.json. */
export function tchHeight(type: StitchType): number {
  return BY_ID.get(type)?.tch ?? 1;
}

/** Does a node of this type count as a stitch (stitches.json `counts`)? */
export function typeCounts(type: StitchType): boolean {
  return BY_ID.get(type)?.counts ?? false;
}

/** Full English name of a stitch type ("double crochet"), US. */
export function longName(type: StitchType): string {
  return BY_ID.get(type)?.name ?? type;
}

type WordTable = Map<string, BaseType | 'slst'>;

function buildTable(terms: Terms): WordTable {
  const t: WordTable = new Map();
  for (const id of [...BASE_TYPES, 'slst'] as const) {
    const def = BY_ID.get(id)!;
    const words = terms === 'US' ? def.us : def.uk;
    for (const w of words) if (!w.includes(' ')) t.set(w.toLowerCase(), id);
  }
  // slst spellings are unambiguous in both dialects; accept the US single-word forms in UK too.
  if (terms === 'UK') {
    t.set('slst', 'slst');
    t.set('sl', 'slst');
  }
  return t;
}

const TABLES: Record<Terms, WordTable> = { US: buildTable('US'), UK: buildTable('UK') };

/** A single-word basic stitch name (sc, dc, htr, ss…) in the given terms → US base type. */
export function baseFromWord(word: string, terms: Terms): BaseType | 'slst' | undefined {
  return TABLES[terms].get(word.toLowerCase());
}

/** Canonical name of a type in the given terms ("sc" / "dc"; "sl st" / "ss"). */
export function nameOf(type: StitchType, terms: Terms): string {
  if (type === 'slst') return terms === 'US' ? 'sl st' : 'ss';
  const def = BY_ID.get(type);
  if (!def) return type;
  return (terms === 'US' ? def.us[0] : def.uk[0]) ?? type;
}

/** Skip keyword in the given terms. */
export function skipWord(terms: Terms): string {
  return terms === 'US' ? 'sk' : 'miss';
}

/** Words the parser understands as stitch names (for "did you mean"). */
function knownWords(terms: Terms): string[] {
  const words = new Set<string>(TABLES[terms].keys());
  for (const w of [
    'ch', 'inc', 'dec', 'invdec', 'cl', 'bobble', 'puff', 'pc', 'popcorn', 'picot', 'shell',
    'vst', 'v-st', 'sl st', 'join', 'turn', 'mr', 'sk', 'skip', 'fo',
  ]) words.add(w);
  for (const b of BASE_TYPES) {
    const n = nameOf(b, terms);
    words.add(`${n}2tog`);
    words.add(`${n}3tog`);
    words.add(`fp${n}`);
    words.add(`bp${n}`);
  }
  return [...words];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

/** Closest known stitch words to `word` (edit distance 1, or 2 for longer words). */
export function suggestions(word: string, terms: Terms): string[] {
  const w = word.toLowerCase();
  const max = w.length <= 3 ? 1 : 2;
  const scored = knownWords(terms)
    .map((k) => ({ k, d: levenshtein(w, k) }))
    .filter((x) => x.d > 0 && x.d <= max)
    .sort((a, b) => a.d - b.d || a.k.localeCompare(b.k));
  return scored.slice(0, 3).map((x) => x.k);
}

/**
 * Hint for an unknown stitch word: is it a stitch of the other dialect? Otherwise "did you mean".
 * Compound words (htr2tog, fphtr) are recognised by their base part.
 */
export function unknownStitchHint(word: string, terms: Terms): string {
  const w = word.toLowerCase();
  const other: Terms = terms === 'US' ? 'UK' : 'US';
  const m = /^(fp|bp)?([a-z]+?)(\d+tog)?$/.exec(w);
  const basePart = m ? m[2] : w;
  const otherBase = baseFromWord(basePart, other);
  if (otherBase && !baseFromWord(basePart, terms)) {
    if (terms === 'US') {
      return ` "${basePart}" is a UK term (US ${nameOf(otherBase, 'US')}); this pattern uses US terms — add "terms: UK" to the header if the whole pattern is written in UK terms.`;
    }
    return ` "${basePart}" is a US term; this pattern says "terms: UK", where US ${basePart} is written ${nameOf(otherBase, 'UK')}.`;
  }
  const s = suggestions(w, terms);
  if (s.length) return ` Did you mean ${s.map((x) => `"${x}"`).join(' or ')}?`;
  return '';
}
