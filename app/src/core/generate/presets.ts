/** Preset designs, as data: a DoilySpec each (parameters left on auto are solved for flatness). */
import type { DoilySpec } from './types';

export interface Preset {
  id: string;
  label: string;
  blurb: string;
  spec: DoilySpec;
}

export const PRESETS: Preset[] = [
  {
    id: 'classic-12',
    label: 'Classic 12-point',
    blurb: 'Wheel centre, open shells, a mesh of growing loops and a picot edge.',
    spec: {
      symmetry: 12, title: 'Classic twelve-point doily',
      rounds: [
        { motif: 'centre', params: { style: 'solid', st: 'dc' } },
        { motif: 'spokes', params: { st: 'dc' } },
        { motif: 'shells', params: { gap: 1 } },
        { motif: 'mesh' },
        { motif: 'arches' },
        { motif: 'shells', params: { alt: 0 } },
        { motif: 'mesh' },
        { motif: 'arches' },
        { motif: 'picot' },
      ],
    },
  },
  {
    id: 'spiderweb',
    label: 'Spiderweb',
    blurb: 'Long spokes, then loops on loops that lengthen outwards, finished with scallops.',
    spec: {
      symmetry: 10, title: 'Spiderweb doily', style: { lacy: 0.9 },
      rounds: [
        { motif: 'centre', params: { style: 'spoked' } },
        { motif: 'spokes', params: { st: 'tr' } },
        { motif: 'mesh' },
        { motif: 'arches' },
        { motif: 'arches' },
        { motif: 'arches' },
        { motif: 'fans', params: { form: 'scallop' } },
        { motif: 'picot' },
      ],
    },
  },
  {
    id: 'shell-fan',
    label: 'Shell fan',
    blurb: 'A solid centre opening into rings of shells and a scalloped fan edge.',
    spec: {
      symmetry: 8, title: 'Shell fan doily', style: { lacy: 0.5 },
      rounds: [
        { motif: 'centre', params: { st: 'dc' } },
        { motif: 'solid', params: { st: 'dc' } },
        { motif: 'shells', params: { alt: 1 } },
        { motif: 'shells', params: { gap: 2 } },
        { motif: 'mesh' },
        { motif: 'shells', params: { alt: 1 } },
        { motif: 'fans', params: { form: 'scallop' } },
      ],
    },
  },
  {
    id: 'petal-flower',
    label: 'Petal flower',
    blurb: 'A ring of clusters, treble-cluster petals, netting and a picot edge.',
    spec: {
      symmetry: 8, title: 'Petal flower doily',
      rounds: [
        { motif: 'centre', params: { st: 'dc' } },
        { motif: 'clusters' },
        { motif: 'mesh' },
        { motif: 'petals', params: { base: 'tr' } },
        { motif: 'mesh' },
        { motif: 'arches' },
        { motif: 'vstitch' },
        { motif: 'picot' },
      ],
    },
  },
  {
    id: 'popcorn-mandala',
    label: 'Popcorn mandala',
    blurb: 'Mostly solid: dc bands with popcorn and puff accents, a V-stitch ring and a picot rim.',
    spec: {
      symmetry: 6, title: 'Popcorn mandala', style: { lacy: 0.2 },
      rounds: [
        { motif: 'centre', params: { st: 'dc' } },
        { motif: 'solid', params: { st: 'dc' } },
        { motif: 'accent', params: { kind: 'pc' } },
        { motif: 'solid', params: { st: 'dc' } },
        { motif: 'vstitch' },
        { motif: 'filler' },
        { motif: 'accent', params: { kind: 'puff' } },
        { motif: 'solid' },
        { motif: 'picot' },
      ],
    },
  },
  {
    id: 'coaster',
    label: 'Little coaster',
    blurb: 'Five quick rounds: a solid disc, puffs and a fan edge.',
    spec: {
      symmetry: 6, title: 'Puff coaster', style: { lacy: 0.3 },
      rounds: [
        { motif: 'centre', params: { st: 'dc' } },
        { motif: 'solid', params: { st: 'dc' } },
        { motif: 'puffs' },
        { motif: 'shells', params: { alt: 0 } },
        { motif: 'fans', params: { form: 'shell' } },
      ],
    },
  },
  {
    id: 'ruffle-rim',
    label: 'Ruffled rim',
    blurb: 'A flat lace centre whose last two rounds are deliberately over-full, so the edge waves.',
    spec: {
      symmetry: 12, title: 'Ruffled rim doily', target: { shape: 'ruffle', rounds: 2, amount: 0.15 },
      rounds: [
        { motif: 'centre' },
        { motif: 'spokes' },
        { motif: 'mesh' },
        { motif: 'shells', params: { alt: 1 } },
        { motif: 'mesh' },
        { motif: 'shells', params: { alt: 0, gap: 0 } },
        { motif: 'fans', params: { form: 'scallop' } },
      ],
    },
  },
  {
    id: 'bowl',
    label: 'Little bowl',
    blurb: 'Solid rounds that stop increasing at the end, so the sides rise into a bowl.',
    spec: {
      symmetry: 6, title: 'Little bowl', target: { shape: 'bowl', rounds: 3, amount: 0.25 }, style: { lacy: 0 },
      rounds: [
        { motif: 'centre', params: { st: 'sc' } },
        { motif: 'solid', params: { st: 'sc' } },
        { motif: 'solid', params: { st: 'sc' } },
        { motif: 'solid', params: { st: 'sc' } },
        { motif: 'solid', params: { st: 'sc' } },
        { motif: 'solid', params: { st: 'sc' } },
        { motif: 'solid', params: { st: 'sc' } },
        { motif: 'solid', params: { st: 'sc' } },
      ],
    },
  },
];
