/**
 * Fixture suite: every spec/fixtures/*.cro compiles cleanly, hits expected.json counts, validates
 * against the JSON Schema and the structural validator, matches the committed .graph.json, and
 * survives a print → parse round trip in US and UK terms. tiny.cro must compile to tiny.graph.json.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { compilePattern, parse, print } from './index';
import { compile, stableJson, stripSrc, validatePattern, type Pattern } from '../graph/index';

const specDir = fileURLToPath(new URL('../../../../spec/', import.meta.url));
const fixturesDir = `${specDir}fixtures/`;
const schema = JSON.parse(readFileSync(`${specDir}pattern.schema.json`, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

const names = readdirSync(fixturesDir).filter((f) => f.endsWith('.cro')).map((f) => f.replace(/\.cro$/, '')).sort();

function graphOnly(p: Pattern) {
  const s = stripSrc(p) as Pattern;
  delete s.notation;
  return s;
}

describe('fixtures', () => {
  it('has fixtures', () => expect(names.length).toBeGreaterThanOrEqual(7));

  for (const name of names) {
    describe(name, () => {
      const text = readFileSync(`${fixturesDir}${name}.cro`, 'utf8');
      const expected = JSON.parse(readFileSync(`${fixturesDir}${name}.expected.json`, 'utf8'));
      const res = compilePattern(text);

      it('compiles with no errors and no warnings', () => {
        expect(res.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
        expect(res.pattern).toBeDefined();
      });

      it('per-round stitchCount matches expected.json', () => {
        const got = res.pattern!.graph.rounds.map((r) => r.stitchCount);
        expect(got).toEqual(expected.rounds.map((r: { stitches: number }) => r.stitches));
      });

      it('validates against pattern.schema.json', () => {
        const ok = validateSchema(res.pattern);
        expect(validateSchema.errors ?? []).toEqual([]);
        expect(ok).toBe(true);
      });

      it('passes the structural validator', () => {
        expect(validatePattern(res.pattern!)).toEqual([]);
      });

      it('meta comes from the headers and notation is the source', () => {
        expect(res.pattern!.meta.title).toBe(expected.title);
        expect(res.pattern!.notation).toBe(text);
      });

      it('committed .graph.json is up to date (npm run fixtures)', () => {
        const path = `${fixturesDir}${name}.graph.json`;
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, 'utf8')).toBe(stableJson(res.pattern));
      });

      for (const terms of ['US', 'UK'] as const) {
        it(`printer round trip in ${terms} terms compiles to the same graph`, () => {
          const printed = print(res.ast!, { terms });
          const again = parse(printed);
          expect(again.diagnostics).toEqual([]);
          expect(again.ast.terms).toBe(terms);
          const c = compile(again.ast);
          expect(c.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
          const a = graphOnly(res.pattern!);
          const b = graphOnly(c.pattern!);
          expect(b.graph).toEqual(a.graph);
          // printing is a fixpoint
          expect(print(again.ast, { terms })).toBe(printed);
        });
      }
    });
  }
});

describe('spec/examples/tiny', () => {
  it('compiles to exactly tiny.graph.json (ignoring src and notation)', () => {
    const text = readFileSync(`${specDir}examples/tiny.cro`, 'utf8');
    const res = compilePattern(text);
    expect(res.diagnostics).toEqual([]);
    const ref = JSON.parse(readFileSync(`${specDir}examples/tiny.graph.json`, 'utf8'));
    expect(graphOnly(res.pattern!)).toEqual(stripSrc(ref));
    expect(validateSchema(res.pattern)).toBe(true);
    expect(validatePattern(res.pattern!)).toEqual([]);
  });
});
