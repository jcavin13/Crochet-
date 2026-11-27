/** Stable JSON helpers for graph files (1-space indent, trailing newline). */
import type { Pattern } from './types';

/** JSON with 1-space indent and a trailing newline (the format of spec/**.graph.json). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 1) + '\n';
}

/** Deep copy of a pattern without `src` on nodes and rounds. */
export function stripSrc<T extends Pattern | Record<string, unknown>>(p: T): T {
  return JSON.parse(JSON.stringify(p, (k, v) => (k === 'src' ? undefined : v)));
}
