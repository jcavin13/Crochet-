// Hooks every feature page uses. See src/features/README.md for the contract.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import stitchParams from '@spec/stitch_params.json';
import { compilePattern, type Diagnostic, type Pattern } from './coreApi';
import { builtinById, builtins, defaultPatternId, type BuiltinRecord } from './builtins';
import { useLibrary, sortedRecords } from '@/store/library';
import { useSettings } from '@/store/settings';
import { readHeaders } from '@/store/text';
import type { PatternRecord } from '@/store/types';

/* ------------------------------------------------------------------ patterns */

/** Look up a record (built-in or user) by id. */
export function usePatternRecord(id: string | undefined): PatternRecord | BuiltinRecord | undefined {
  const rec = useLibrary((s) => (id ? s.records[id] : undefined));
  return id ? builtinById[id] ?? rec : undefined;
}

/** All patterns: the user's (newest first) and the built-ins. */
export function useAllPatterns(): { mine: PatternRecord[]; builtins: BuiltinRecord[]; hydrated: boolean } {
  const records = useLibrary((s) => s.records);
  const hydrated = useLibrary((s) => s.hydrated);
  const mine = useMemo(() => sortedRecords(records), [records]);
  return { mine, builtins, hydrated };
}

/** Value that lags `value` by `ms`, except when `resetKey` changes (then it is immediate). */
export function useDebounced<T>(value: T, ms: number, resetKey?: unknown): T {
  const [state, setState] = useState({ value, key: resetKey });
  useEffect(() => {
    if (state.key !== resetKey) { setState({ value, key: resetKey }); return; }
    if (Object.is(state.value, value)) return;
    const t = setTimeout(() => setState({ value, key: resetKey }), ms);
    return () => clearTimeout(t);
  }, [value, ms, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.key !== resetKey ? value : state.value;
}

/** Compile text (cached), debounced by `ms` while it is changing. */
export function useCompiled(text: string, ms = 250, resetKey?: unknown) {
  const debounced = useDebounced(text, ms, resetKey);
  const res = useMemo(() => compilePattern(debounced), [debounced]);
  return { ...res, pending: debounced !== text };
}

export type CurrentPattern = {
  /** Resolved pattern id (from the route's :id, else the last opened, else the default built-in). */
  id: string | undefined;
  /** 'loading' while the user library hydrates, 'missing' for an unknown id. */
  status: 'ready' | 'loading' | 'missing';
  record: PatternRecord | BuiltinRecord | undefined;
  /** Notation source. */
  text: string;
  /** Compiled graph (undefined when the notation has errors), or an imported graph. */
  pattern: Pattern | undefined;
  diagnostics: Diagnostic[];
  /** True while a debounced compile is outstanding. */
  pending: boolean;
  /** Built-ins are read-only (setText is then a no-op); offer duplicate(). */
  readOnly: boolean;
  setText: (text: string) => void;
  /** Copy into the user's library and navigate to the copy (same feature route). */
  duplicate: () => string | undefined;
  /** Navigate the current feature to another pattern. */
  select: (id: string) => void;
};

/** First path segment of the current route, e.g. "chart" for /chart/abc. */
export function useFeatureBase(): string {
  const { pathname } = useLocation();
  return pathname.split('/')[1] || 'editor';
}

export const patternHref = (feature: string, id: string) => `/${feature}/${encodeURIComponent(id)}`;

/**
 * The pattern the current route is about. Works on any route with an optional `:id` param.
 * Compilation is debounced (250 ms) and cached across components.
 */
export function useCurrentPattern(): CurrentPattern {
  const params = useParams();
  const navigate = useNavigate();
  const base = useFeatureBase();
  const lastId = useSettings((s) => s.lastPatternId);
  const hydrated = useLibrary((s) => s.hydrated);
  const userRecords = useLibrary((s) => s.records);

  const param = params.id ? decodeURIComponent(params.id) : undefined;
  const lastValid = lastId && (builtinById[lastId] || userRecords[lastId] || !hydrated) ? lastId : undefined;
  const id = param ?? lastValid ?? defaultPatternId;
  const record = id ? builtinById[id] ?? userRecords[id] : undefined;
  const status: CurrentPattern['status'] = record ? 'ready' : !hydrated ? 'loading' : 'missing';

  const text = record?.text ?? '';
  const compiled = useCompiled(text, 250, id);
  const pattern = record?.graph ?? compiled.pattern;

  useEffect(() => {
    if (record && id && id !== useSettings.getState().lastPatternId) useSettings.getState().set({ lastPatternId: id });
  }, [id, record]);

  const readOnly = !!record?.readOnly;
  const setText = useCallback((t: string) => { if (id && !readOnly) useLibrary.getState().setText(id, t); }, [id, readOnly]);
  const select = useCallback((next: string) => navigate(patternHref(base, next)), [navigate, base]);
  const duplicate = useCallback(() => {
    if (!record) return undefined;
    const copy = useLibrary.getState().duplicate(record);
    navigate(patternHref(base, copy.id));
    return copy.id;
  }, [record, navigate, base]);

  return {
    id, status, record, text, pattern,
    // an imported graph-only record has placeholder text; its diagnostics would be noise
    diagnostics: record?.graph ? [] : compiled.diagnostics,
    pending: compiled.pending, readOnly, setText, duplicate, select,
  };
}

/* ------------------------------------------------------------------ stitch params */

export type StitchParam = { width: number; height: number; stiffness: number };
export type StitchParamSet = {
  id: string; label: string; yarn_weight?: string; hook_mm?: number; status?: string; provenance?: string;
  stitches: Record<string, StitchParam>;
};
export type StitchParamsFile = { version: string; units: string; default_set: string; sets: StitchParamSet[] };

const paramsFile = stitchParams as unknown as StitchParamsFile;

/**
 * Stitch parameters (spec/stitch_params.json) and the selected set.
 * Selection: the user's setting if not 'auto'; else the pattern's `params:` header; else default_set.
 * Pass the current pattern (or its text / a params id) so 'auto' can follow it.
 */
export function useStitchParams(hint?: Pattern | string) {
  const setting = useSettings((s) => s.paramsSet);
  const fromHint = typeof hint === 'string'
    ? (hint.includes('\n') || hint.includes(':') ? readHeaders(hint).params : hint)
    : (hint?.meta?.params as string | undefined);
  const byId = (id?: string) => paramsFile.sets.find((s) => s.id === id);
  const selected = (setting !== 'auto' && byId(setting)) || byId(fromHint) || byId(paramsFile.default_set) || paramsFile.sets[0];
  const setSelectedId = useCallback((id: string) => useSettings.getState().set({ paramsSet: id }), []);
  return {
    file: paramsFile,
    sets: paramsFile.sets,
    defaultSetId: paramsFile.default_set,
    /** 'auto' or a set id */
    setting,
    selected,
    selectedId: selected.id,
    setSelectedId,
  };
}
