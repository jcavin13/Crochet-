// Cheap, compiler-independent reads of .cro text (header values, declared counts). These are for
// labels and thumbnails only; the compiler in src/core is the authority.

const ROUND_RE = /^\s*(rnds?|rounds?|rows?|r|foundation|start|setup)\b[^:\n]*:/i;

/** Header `key: value` lines before the first round line. Keys lower-cased. */
export function readHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (ROUND_RE.test(line)) break;
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export function extractTitle(text: string, fallback = 'Untitled pattern'): string {
  return readHeaders(text).title || fallback;
}

/**
 * Title of the copy made when the user types or pastes into a read-only built-in (review R14):
 * the new text's `title:` header; without one, "Untitled pattern" — unless the built-in never had
 * a title header either (its title came from the file name), then that name.
 */
export function forkTitle(newText: string, builtin: { text: string; title: string }): string {
  const t = readHeaders(newText).title;
  if (t) return t;
  return readHeaders(builtin.text).title ? 'Untitled pattern' : builtin.title;
}

/** Replace (or insert) the `title:` header. */
export function setTitleInText(text: string, title: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (ROUND_RE.test(lines[i])) break;
    if (/^\s*title\s*:/i.test(lines[i])) {
      lines[i] = `title: ${title}`;
      return lines.join('\n');
    }
  }
  // insert after leading comment lines
  let at = 0;
  while (at < lines.length && /^\s*#/.test(lines[at])) at++;
  lines.splice(at, 0, `title: ${title}`);
  return lines.join('\n');
}

/**
 * Per-round declared stitch counts read from trailing `(N …)` annotations; range labels
 * (`Rnds 6-10:`) expand. Rounds without an annotation give null.
 */
export function declaredCounts(text: string): (number | null)[] {
  const out: (number | null)[] = [];
  const chunks: { mult: number; body: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '');
    const m = /^\s*(?:rnds?|rounds?|rows?|r)\s*(\d+)(?:\s*-\s*(\d+))?\s*:(.*)$/i.exec(line);
    const f = /^\s*(?:foundation|start|setup)\s*:(.*)$/i.exec(line);
    if (m) {
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      chunks.push({ mult: Math.max(1, b - a + 1), body: m[3] });
    } else if (f) {
      chunks.push({ mult: 1, body: f[1] });
    } else if (chunks.length && line.trim() && !/^\s*[A-Za-z][\w-]*\s*:/.test(line)) {
      chunks[chunks.length - 1].body += ' ' + line;
    }
  }
  for (const c of chunks) {
    const ann = /\(\s*(\d+)[^()]*\)\s*\.?\s*$/.exec(c.body.trim());
    let n: number | null = null;
    if (ann) {
      // "(16 dc, 16 ch-1 sps)" → first number that is not a space count
      const parts = ann[0].slice(1, -1).split(',').map((s) => s.trim());
      const st = parts.find((p) => !/sp|loop/i.test(p)) ?? parts[0];
      n = parseInt(st, 10);
      if (Number.isNaN(n)) n = null;
    }
    for (let i = 0; i < c.mult; i++) out.push(n);
  }
  return out;
}
