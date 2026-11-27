// Built-in, read-only patterns bundled at build time: spec/fixtures/*.cro and data/corpus/**/*.cro.
// Both globs tolerate empty/missing directories. Bundled into JS, so they are precached offline.
import type { PatternRecord } from '@/store/types';
import { extractTitle, readHeaders } from '@/store/text';
import type { ShapeClass } from '@/ui';

const fixtureFiles = import.meta.glob<string>('@spec/fixtures/*.cro', { query: '?raw', import: 'default', eager: true });
const corpusFiles = import.meta.glob<string>('../../../data/corpus/**/*.cro', { query: '?raw', import: 'default', eager: true });
const expectedFiles = import.meta.glob<{ shape?: ShapeClass }>('@spec/fixtures/*.expected.json', { import: 'default', eager: true });

const stem = (path: string) => path.split('/').pop()!.replace(/\.cro$/, '').replace(/\.expected\.json$/, '');

export type BuiltinRecord = PatternRecord & {
  readOnly: true;
  slug: string;
  /** Expected shape class from `<name>.expected.json` (fixtures only). */
  expectedShape?: ShapeClass;
  /** `source:` / `license:` headers, for attribution. */
  source?: string;
  license?: string;
};

function build(files: Record<string, string>, origin: 'fixture' | 'corpus'): BuiltinRecord[] {
  const shapes = Object.fromEntries(Object.entries(expectedFiles).map(([p, v]) => [stem(p), v?.shape]));
  return Object.entries(files)
    .map(([path, text]) => {
      const slug = stem(path);
      const h = readHeaders(text);
      return {
        id: `${origin}:${slug}`,
        slug,
        title: extractTitle(text, slug.replace(/_/g, ' ')),
        text,
        createdAt: 0,
        updatedAt: 0,
        origin,
        readOnly: true as const,
        expectedShape: origin === 'fixture' ? shapes[slug] : undefined,
        source: h.source,
        license: h.license,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Curated order for the gallery: lace first (the project's focus), then shape demos.
const FIXTURE_ORDER = ['simple_doily', 'chain_space_motif', 'flat_dc_circle', 'flat_sc_circle', 'hyperbolic_plane', 'sc_cone', 'sc_sphere'];
const rank = (slug: string) => { const i = FIXTURE_ORDER.indexOf(slug); return i < 0 ? 99 : i; };

export const fixtures: BuiltinRecord[] = build(fixtureFiles, 'fixture').sort((a, b) => rank(a.slug) - rank(b.slug));
export const corpus: BuiltinRecord[] = build(corpusFiles, 'corpus');
export const builtins: BuiltinRecord[] = [...fixtures, ...corpus];
export const builtinById: Record<string, BuiltinRecord> = Object.fromEntries(builtins.map((b) => [b.id, b]));

/** Default pattern for routes opened without an id. */
export const defaultPatternId = builtinById['fixture:simple_doily'] ? 'fixture:simple_doily' : builtins[0]?.id;
