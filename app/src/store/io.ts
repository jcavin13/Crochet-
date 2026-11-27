// Import / export of patterns as files: `.cro` notation text or `.crochet.json` graph JSON
// (spec/pattern.schema.json). Parsing is pure (unit-tested); download/upload touch the DOM.
import { compilePattern, isPatternJson, type Pattern } from '@/app/coreApi';
import { extractTitle } from './text';
import type { PatternRecord } from './types';

export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'pattern';
}

export type ParsedImport = { text: string; title: string; graph?: Pattern };

/**
 * Turn an uploaded file's contents into something the library can store.
 * JSON must be a crochet-pattern graph; if it carries `notation`, that becomes the text.
 */
export function parseImport(fileName: string, content: string): ParsedImport {
  const trimmed = content.trimStart();
  const looksJson = /\.json$/i.test(fileName) || trimmed.startsWith('{');
  if (looksJson) {
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (e) {
      throw new Error(`${fileName} is not valid JSON: ${(e as Error).message}`);
    }
    if (!isPatternJson(data)) throw new Error(`${fileName} is not a crochet pattern graph (expected "format": "crochet-pattern").`);
    const title = String(data.meta?.title || fileName.replace(/\.(crochet\.)?json$/i, ''));
    if (typeof data.notation === 'string' && data.notation.trim()) {
      return { text: data.notation, title: extractTitle(data.notation, title) };
    }
    const text = `# Imported from ${fileName} (graph only, no notation).\n# Editing this text replaces the imported graph.\ntitle: ${title}\n`;
    return { text, title, graph: data };
  }
  const text = content.replace(/\r\n?/g, '\n');
  const fallback = fileName.replace(/\.(cro|txt)$/i, '').replace(/[_-]+/g, ' ');
  return { text, title: extractTitle(text, fallback || 'Imported pattern') };
}

export type ExportFile = { name: string; mime: string; content: string };

export function exportCro(rec: Pick<PatternRecord, 'title' | 'text'>): ExportFile {
  return { name: `${slugify(rec.title)}.cro`, mime: 'text/plain;charset=utf-8', content: rec.text.endsWith('\n') ? rec.text : rec.text + '\n' };
}

/** Graph JSON. Compiles the text; throws with the first error if it does not compile. */
export function exportGraphJson(rec: Pick<PatternRecord, 'title' | 'text' | 'graph'>): ExportFile {
  let pattern = rec.graph;
  if (!pattern) {
    const res = compilePattern(rec.text);
    if (!res.pattern) {
      const first = res.diagnostics.find((d) => d.severity === 'error') ?? res.diagnostics[0];
      throw new Error(first ? `Cannot export graph: ${first.message}` : 'Cannot export graph: the pattern does not compile.');
    }
    pattern = { ...res.pattern, notation: res.pattern.notation ?? rec.text };
  }
  return { name: `${slugify(rec.title)}.crochet.json`, mime: 'application/json', content: JSON.stringify(pattern, null, 1) + '\n' };
}

/** Trigger a browser download. */
export function downloadFile(f: ExportFile) {
  const url = URL.createObjectURL(new Blob([f.content], { type: f.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker; resolves with the chosen files' names and text (empty if cancelled). */
export function pickFiles(accept = '.cro,.txt,.json'): Promise<{ name: string; content: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() }))));
    };
    input.click();
  });
}
