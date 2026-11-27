import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryKV, setKVBackends, kv } from './kv';
import { useLibrary, sortedRecords } from './library';
import { getPersistent, loadPersistent, resetPersistentCache, setPersistent } from './persistentState';
import { exportCro, exportGraphJson, parseImport, slugify } from './io';
import { declaredCounts, extractTitle, readHeaders, setTitleInText } from './text';
import type { PatternRecord } from './types';

let patterns: ReturnType<typeof memoryKV>;
let state: ReturnType<typeof memoryKV>;

beforeEach(() => {
  patterns = memoryKV();
  state = memoryKV();
  setKVBackends({ patterns, state });
  useLibrary.setState({ hydrated: false, records: {}, saving: {} });
  resetPersistentCache();
});

const SAMPLE = `# a comment
title: Test circle
terms: US

Rnd 1: mr, 6 sc in ring. (6)
Rnd 2: inc x6. (12)
`;

describe('library store', () => {
  it('hydrates records from storage', async () => {
    const rec: PatternRecord = { id: 'p-1', title: 'Stored', text: 'title: Stored\n', createdAt: 1, updatedAt: 2, origin: 'user' };
    await patterns.set('pattern:p-1', rec);
    await patterns.set('unrelated', { x: 1 });
    await useLibrary.getState().hydrate();
    expect(useLibrary.getState().hydrated).toBe(true);
    expect(Object.keys(useLibrary.getState().records)).toEqual(['p-1']);
  });

  it('creates, derives the title, and persists immediately', async () => {
    const rec = useLibrary.getState().create({ text: SAMPLE });
    expect(rec.title).toBe('Test circle');
    expect(rec.origin).toBe('user');
    await vi.waitFor(async () => expect(await patterns.get(`pattern:${rec.id}`)).toMatchObject({ title: 'Test circle' }));
  });

  it('setText updates the title and writes after a debounce; flush forces it', async () => {
    vi.useFakeTimers();
    const rec = useLibrary.getState().create({ text: SAMPLE });
    await Promise.resolve();
    useLibrary.getState().setText(rec.id, SAMPLE.replace('Test circle', 'Renamed'));
    expect(useLibrary.getState().records[rec.id].title).toBe('Renamed');
    expect(useLibrary.getState().saving[rec.id]).toBe(true);
    expect((await patterns.get<PatternRecord>(`pattern:${rec.id}`))?.title).toBe('Test circle');
    vi.useRealTimers();
    await useLibrary.getState().flush();
    expect((await patterns.get<PatternRecord>(`pattern:${rec.id}`))?.title).toBe('Renamed');
    expect(useLibrary.getState().saving[rec.id]).toBeUndefined();
  });

  it('ignores setText on read-only records and drops an imported graph once edited', () => {
    const ro: PatternRecord = { id: 'fixture:x', title: 'X', text: 'a', createdAt: 0, updatedAt: 0, origin: 'fixture', readOnly: true };
    useLibrary.setState({ records: { [ro.id]: ro } });
    useLibrary.getState().setText(ro.id, 'b');
    expect(useLibrary.getState().records[ro.id].text).toBe('a');

    const g = useLibrary.getState().create({ text: 'title: G\n', graph: { format: 'crochet-pattern', version: '0.1', meta: { title: 'G' }, graph: { nodes: [], spaces: [], rounds: [] } } });
    expect(useLibrary.getState().records[g.id].graph).toBeDefined();
    useLibrary.getState().setText(g.id, 'title: G\nRnd 1: mr, 6 sc in ring.');
    expect(useLibrary.getState().records[g.id].graph).toBeUndefined();
  });

  it('duplicates built-ins as user patterns with the same title, user patterns with "(copy)"', () => {
    const builtin: PatternRecord = { id: 'fixture:y', title: 'Doily', text: SAMPLE, createdAt: 0, updatedAt: 0, origin: 'fixture', readOnly: true };
    const a = useLibrary.getState().duplicate(builtin);
    expect(a).toMatchObject({ title: 'Doily', origin: 'user', text: SAMPLE });
    expect(a.readOnly).toBeUndefined();
    const b = useLibrary.getState().duplicate(a);
    expect(b.title).toBe('Doily (copy)');
    expect(b.id).not.toBe(a.id);
  });

  it('removes from memory and storage', async () => {
    const rec = useLibrary.getState().create({ text: SAMPLE });
    await useLibrary.getState().flush();
    await vi.waitFor(async () => expect(await patterns.get(`pattern:${rec.id}`)).toBeDefined());
    await useLibrary.getState().remove(rec.id);
    expect(useLibrary.getState().records[rec.id]).toBeUndefined();
    expect(await patterns.get(`pattern:${rec.id}`)).toBeUndefined();
  });

  it('sorts newest first', () => {
    const r = (id: string, t: number): PatternRecord => ({ id, title: id, text: '', createdAt: t, updatedAt: t, origin: 'user' });
    expect(sortedRecords({ a: r('a', 1), b: r('b', 3), c: r('c', 2) }).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('survives a storage read failure', async () => {
    setKVBackends({ patterns: { ...memoryKV(), entries: () => Promise.reject(new Error('blocked')) } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await useLibrary.getState().hydrate();
    expect(useLibrary.getState().hydrated).toBe(true);
    warn.mockRestore();
  });
});

describe('persistent state', () => {
  it('loads, sets with an updater, and writes through', async () => {
    await state.set('counter:a', { row: 3 });
    await loadPersistent('counter:a', { row: 0 });
    expect(getPersistent('counter:a', { row: 0 })).toEqual({ row: 3 });
    await setPersistent<{ row: number }>('counter:a', (p) => ({ row: p.row + 1 }));
    expect(getPersistent('counter:a', { row: 0 })).toEqual({ row: 4 });
    expect(await kv.state.get('counter:a')).toEqual({ row: 4 });
  });

  it('uses the initial value when nothing is stored', async () => {
    await loadPersistent('nothing', 7);
    expect(getPersistent('nothing', 7)).toBe(7);
  });
});

describe('import / export', () => {
  it('parses .cro text (CRLF-normalised) and takes the title header', () => {
    const p = parseImport('my_doily.cro', SAMPLE.replace(/\n/g, '\r\n'));
    expect(p.title).toBe('Test circle');
    expect(p.text).not.toContain('\r');
    expect(p.graph).toBeUndefined();
  });

  it('falls back to the file name for an untitled .cro', () => {
    expect(parseImport('lace_edge.cro', 'Rnd 1: mr, 6 sc in ring.').title).toBe('lace edge');
  });

  const graph = { format: 'crochet-pattern', version: '0.1', meta: { title: 'From JSON' }, graph: { nodes: [], spaces: [], rounds: [] } };

  it('imports graph JSON with notation as text', () => {
    const p = parseImport('x.crochet.json', JSON.stringify({ ...graph, notation: SAMPLE }));
    expect(p.text).toBe(SAMPLE);
    expect(p.title).toBe('Test circle');
    expect(p.graph).toBeUndefined();
  });

  it('imports graph-only JSON keeping the graph', () => {
    const p = parseImport('x.crochet.json', JSON.stringify(graph));
    expect(p.title).toBe('From JSON');
    expect(p.graph?.format).toBe('crochet-pattern');
    expect(p.text).toContain('title: From JSON');
  });

  it('rejects non-pattern JSON and broken JSON', () => {
    expect(() => parseImport('a.json', '{"hello":1}')).toThrow(/not a crochet pattern/);
    expect(() => parseImport('a.json', '{oops')).toThrow(/not valid JSON/);
  });

  it('exports .cro with a slug file name and trailing newline', () => {
    const f = exportCro({ title: 'Simple Doily (16-fold)', text: 'title: x' });
    expect(f.name).toBe('simple-doily-16-fold.cro');
    expect(f.content.endsWith('\n')).toBe(true);
  });

  it('exports an imported graph as JSON without compiling', () => {
    const f = exportGraphJson({ title: 'G', text: '', graph: graph as never });
    expect(f.name).toBe('g.crochet.json');
    expect(JSON.parse(f.content).format).toBe('crochet-pattern');
  });

  it('slugify never returns empty', () => {
    expect(slugify('***')).toBe('pattern');
  });
});

describe('text helpers', () => {
  it('reads headers only above the first round', () => {
    expect(readHeaders(SAMPLE)).toEqual({ title: 'Test circle', terms: 'US' });
    expect(extractTitle('Rnd 1: x\ntitle: late')).toBe('Untitled pattern');
  });

  it('sets or inserts the title', () => {
    expect(extractTitle(setTitleInText(SAMPLE, 'New'))).toBe('New');
    expect(setTitleInText('# c\nRnd 1: x', 'T')).toBe('# c\ntitle: T\nRnd 1: x');
  });

  it('reads declared counts, expanding ranges and continuation lines', () => {
    const t = `title: s\nRnd 1: mr, 6 sc in ring. (6)\nRnds 2-3: sc in each st\n  around. (6)\nRnd 4: ch 4 (counts as dc, ch 1), *dc, ch 1* x15, join. (16 dc, 16 ch-1 sps)\nRnd 5: no count`;
    expect(declaredCounts(t)).toEqual([6, 6, 6, 16, null]);
  });
});
