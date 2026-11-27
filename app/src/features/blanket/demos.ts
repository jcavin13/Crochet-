// Example designs: "start from an example" chips, and #/blanket?demo=<id> links (screenshots).
import { DEFAULT_SPEC, PALETTES, paletteFrom, type BlanketSpec } from '@/core/blanket';

export interface Demo { id: string; name: string; spec: BlanketSpec; step?: number }

const pal = (id: string) => paletteFrom(PALETTES.find((p) => p.id === id)!.colors);

export const DEMOS: Demo[] = [
  {
    id: 'moss-throw', name: 'Moss-stitch throw, shell border',
    spec: { ...DEFAULT_SPEC, construction: 'rect', size: { preset: 'throw', widthCm: 127, heightCm: 152 }, body: { pattern: 'moss' },
      palette: pal('oat'), stripes: { kind: 'even', rows: 14, colors: ['A', 'B', 'A', 'C'] },
      border: { enabled: true, rowEnds: 'auto', edgeCorner: 'sc3', edgeColor: 'E', layers: [{ kind: 'sc', color: 'E' }, { kind: 'shell', color: 'A' }] } },
  },
  {
    id: 'granny-stripe-baby', name: 'Granny-stripe baby blanket',
    spec: { ...DEFAULT_SPEC, construction: 'rect', size: { preset: 'baby', widthCm: 90, heightCm: 90 }, body: { pattern: 'granny' }, paramsId: 'dk-3_4.0mm',
      palette: pal('nursery'), stripes: { kind: 'even', rows: 2, colors: ['B', 'C', 'D', 'E'] },
      border: { enabled: true, rowEnds: 'auto', edgeCorner: 'sc3', edgeColor: 'A', layers: [{ kind: 'granny', color: 'A' }, { kind: 'sc', color: 'B' }, { kind: 'picot', color: 'A' }] } },
  },
  {
    id: 'giant-granny', name: 'Giant granny square, 6 colours',
    spec: { ...DEFAULT_SPEC, construction: 'round', size: { preset: 'baby', widthCm: 90, heightCm: 90 }, palette: pal('rainbow'),
      stripes: { kind: 'even', rows: 2, colors: ['A', 'B', 'C', 'D', 'E', 'F'] }, round: { style: 'granny-square', textures: ['granny'], corner: 'auto' } },
  },
  {
    id: 'hexagon', name: 'Hexagon blanket',
    spec: { ...DEFAULT_SPEC, construction: 'round', size: { preset: 'stroller', widthCm: 80, heightCm: 80 }, palette: pal('sea'),
      stripes: { kind: 'gradient', colors: ['A', 'B', 'C', 'D', 'E'] }, round: { style: 'hexagon', textures: ['dc', 'dc', 'sc-blo'], corner: 'auto' } },
  },
  {
    id: 'circle-to-square', name: 'Circle to square',
    spec: { ...DEFAULT_SPEC, construction: 'round', size: { preset: 'baby', widthCm: 90, heightCm: 90 }, palette: pal('sunset'),
      stripes: { kind: 'fibonacci', unit: 1, colors: ['A', 'B', 'C', 'D', 'E'] }, round: { style: 'circle-to-square', textures: ['dc', 'hdc'], corner: 'auto' } },
  },
  {
    id: 'mandala', name: 'Mandala circle with lace edge',
    spec: { ...DEFAULT_SPEC, construction: 'round', size: { widthCm: 100, heightCm: 100 }, palette: pal('sunset'),
      stripes: { kind: 'random', seed: 5, min: 1, max: 3, colors: ['A', 'B', 'C', 'D', 'E'] }, round: { style: 'mandala', textures: ['dc', 'dc', 'sc-blo', 'hdc'], corner: 'auto', lace: true } },
  },
  {
    id: 'motifs', name: 'Granny-square motif blanket',
    spec: { ...DEFAULT_SPEC, construction: 'motif', size: { preset: 'throw', widthCm: 127, heightCm: 152 }, palette: pal('oat'),
      motif: { style: 'granny-square', rounds: 5, cols: 8, rows: 10, join: 'sc', layout: 'random', colorways: 4, seed: 11 } },
    step: 2,
  },
  {
    id: 'edge-fit', name: 'Edge-fit warning (dc body, 3 sc per row end)',
    spec: { ...DEFAULT_SPEC, construction: 'rect', size: { preset: 'lapghan', widthCm: 90, heightCm: 120 }, body: { pattern: 'dc' }, palette: pal('sea'),
      stripes: { kind: 'even', rows: 6, colors: ['A', 'B', 'C'] },
      border: { enabled: true, rowEnds: { num: 3, den: 1 }, edgeCorner: 'sc3', edgeColor: 'E', layers: [{ kind: 'sc', color: 'E' }, { kind: 'hdc', color: 'D' }, { kind: 'sc', color: 'E' }] } },
    step: 4,
  },
];

export const DEMO_BY_ID: Record<string, Demo> = Object.fromEntries(DEMOS.map((d) => [d.id, d]));
