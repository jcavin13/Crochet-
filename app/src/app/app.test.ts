import { describe, expect, it } from 'vitest';
import { builtins, defaultPatternId, fixtures } from './builtins';
import { compilePattern, compilerAvailable } from './coreApi';
import { NAV } from './nav';
import { templates } from './templates';

describe('built-in patterns', () => {
  it('bundles every spec fixture as a read-only record', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(7);
    for (const f of fixtures) {
      expect(f.id).toBe(`fixture:${f.slug}`);
      expect(f.readOnly).toBe(true);
      expect(f.text).toMatch(/Rnd 1:/);
      expect(f.title).not.toBe(f.slug);
    }
    expect(defaultPatternId).toBe('fixture:simple_doily');
    expect(fixtures[0].slug).toBe('simple_doily');
  });

  it('attaches expected shapes from *.expected.json', () => {
    const byslug = Object.fromEntries(fixtures.map((f) => [f.slug, f.expectedShape]));
    expect(byslug.flat_sc_circle).toBe('flat');
    expect(byslug.hyperbolic_plane).toBe('ruffle');
  });

  it('has unique ids', () => {
    expect(new Set(builtins.map((b) => b.id)).size).toBe(builtins.length);
  });
});

describe('core adapter', () => {
  it('never throws and always returns diagnostics', () => {
    const r = compilePattern('Rnd 1: mr, 6 sc in ring. (6)');
    expect(Array.isArray(r.diagnostics)).toBe(true);
    if (!compilerAvailable) expect(r.diagnostics[0].code).toBe('I_NO_COMPILER');
  });

  it('compiles every fixture and template without errors once the compiler exists', () => {
    if (!compilerAvailable) return;
    for (const p of [...fixtures, ...templates]) {
      const r = compilePattern(p.text);
      expect(r.diagnostics.filter((d) => d.severity === 'error'), p.title).toEqual([]);
      expect(r.pattern, p.title).toBeDefined();
    }
  });
});

describe('navigation', () => {
  it('has one entry per route and unique paths', () => {
    expect(new Set(NAV.map((n) => n.path)).size).toBe(NAV.length);
    expect(NAV.filter((n) => n.primary).length).toBeLessThanOrEqual(4); // + "More" = 5 tabs on phones
  });
});
