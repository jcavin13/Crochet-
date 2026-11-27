/** stitch_params.json types + loader (spec/stitch_params.schema.json). Pure; no React. */
import paramsJson from '@spec/stitch_params.json';
import simConfigJson from '@spec/sim_config.json';
import type { Node, Pattern, StitchType } from '../graph';

export interface StitchParam { width: number; height: number; stiffness: number }
export interface ParamSet {
  id: string; label: string; yarn_weight: string; hook_mm: number;
  status: 'nominal' | 'fitted'; provenance?: string;
  stitches: Record<string, StitchParam>;
}
export interface ParamsFile { version: string; units: string; default_set: string; sets: ParamSet[] }

export const paramsFile = paramsJson as unknown as ParamsFile;
export const simConfig = simConfigJson;
export type SimConfig = typeof simConfigJson;

export function paramSetById(id?: string): ParamSet | undefined {
  return paramsFile.sets.find((s) => s.id === id);
}
/** Set named by the pattern's `params:` header, else the file's default set. */
export function paramsFor(pattern?: Pattern): ParamSet {
  return paramSetById(pattern?.meta.params) ?? paramSetById(paramsFile.default_set) ?? paramsFile.sets[0];
}
const FALLBACK: StitchParam = { width: 1, height: 1, stiffness: 1 };
export function stitchParam(set: ParamSet, type: StitchType): StitchParam {
  return set.stitches[type] ?? FALLBACK;
}
/** Course width of a node (its own type; a counting turning-chain top is still a chain wide). */
export function widthOf(set: ParamSet, n: Node): number { return stitchParam(set, n.type).width; }
/** Wale height of a node: a turning-chain top that counts as X stands as tall as X. */
export function heightOf(set: ParamSet, n: Node): number { return stitchParam(set, n.countsAs ?? n.type).height; }
