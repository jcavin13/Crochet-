// UI-level pattern actions shared by Editor and Library (file export/import with toasts).
import { toast } from '@/ui';
import { downloadFile, exportCro, exportGraphJson, parseImport, pickFiles } from '@/store/io';
import { useLibrary } from '@/store/library';
import type { PatternRecord } from '@/store/types';

export function exportPattern(rec: PatternRecord, kind: 'cro' | 'json') {
  try {
    const f = kind === 'cro' ? exportCro(rec) : exportGraphJson(rec);
    downloadFile(f);
    toast(`Downloaded ${f.name}`);
  } catch (e) {
    toast((e as Error).message, { tone: 'error', ms: 5000 });
  }
}

/** Ask for files, add them to My patterns. Resolves with the new ids. */
export async function importPatterns(): Promise<string[]> {
  const files = await pickFiles();
  const ids: string[] = [];
  for (const f of files) {
    try {
      const p = parseImport(f.name, f.content);
      ids.push(useLibrary.getState().create({ text: p.text, title: p.title, graph: p.graph, origin: 'user' }).id);
    } catch (e) {
      toast((e as Error).message, { tone: 'error', ms: 5000 });
    }
  }
  if (ids.length) toast(ids.length === 1 ? 'Pattern imported' : `${ids.length} patterns imported`);
  return ids;
}
