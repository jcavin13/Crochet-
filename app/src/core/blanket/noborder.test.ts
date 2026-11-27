import { describe, expect, it } from 'vitest';
import { designBlanket, DEFAULT_SPEC, STITCH_PATTERNS, toUK } from './index';
import { compilePattern } from '../notation';
import { paramsFor } from '../params';

const ids: string[] = (Array.isArray(STITCH_PATTERNS) ? STITCH_PATTERNS : Object.values(STITCH_PATTERNS)).map((p: any) => p.id);

describe('blanket without a border', () => {
  for (const pattern of ids) {
    it(`${pattern}: fastens off on a single final row, not on a range line, and compiles (US and UK)`, () => {
      const res = designBlanket(
        { ...DEFAULT_SPEC, size: { ...DEFAULT_SPEC.size, preset: 'custom', widthCm: 40, heightCm: 45 } as any,
          body: { ...DEFAULT_SPEC.body, pattern } as any, border: { ...DEFAULT_SPEC.border, enabled: false, layers: [] } },
        paramsFor(),
      );
      expect(res.text.trimEnd()).toMatch(/Fasten off\.$/);
      for (const text of [res.text, toUK(res.text)]) {
        const { diagnostics } = compilePattern(text);
        expect(diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`)).toEqual([]);
      }
    });
  }
});
