/**
 * Printer: AST → canonical notation text in US or UK terms.
 *
 * Canonical form: one line per round, items separated by ", ", a final "." and the count
 * annotation; counts always as prefixes ("6 inc", never "inc x6"); repeats always as
 * "*…* xN" / "*…* around". Comments are not preserved.
 *
 * Round-trip property (tested): parse(print(parse(x))) compiles to the same graph as x.
 */
import type { Terms } from '../graph/types';
import type {
  CountAnn, CountPart, Extent, Item, PatternAst, Place, RoundAst, StitchSpec, Target, Times, Unit,
} from './ast';
import { nameOf, skipWord } from './vocab';

export interface PrintOptions {
  terms?: Terms;
}

export function print(ast: PatternAst, opts: PrintOptions = {}): string {
  const terms = opts.terms ?? ast.terms;
  const P = new Printer(terms);
  const lines: string[] = [];
  let sawTerms = false;
  for (const h of ast.headers) {
    if (h.key === 'terms') {
      if (sawTerms) continue;
      sawTerms = true;
      lines.push(`terms: ${terms}`);
    } else {
      lines.push(`${h.key}: ${h.value}`);
    }
  }
  if (!sawTerms && terms !== 'US') {
    const at = lines.findIndex((l) => l.startsWith('title:'));
    lines.splice(at + 1, 0, `terms: ${terms}`);
  }
  if (lines.length) lines.push('');
  for (const r of ast.rounds) lines.push(P.round(r));
  return lines.join('\n') + '\n';
}

class Printer {
  constructor(private terms: Terms) {}

  n(t: Parameters<typeof nameOf>[0]): string {
    return nameOf(t, this.terms);
  }

  round(r: RoundAst): string {
    const L = r.label;
    let label: string;
    if (L.kind === 'foundation') label = 'Foundation';
    else if (L.range) label = `${L.kind === 'row' ? 'Rows' : 'Rnds'} ${L.from}-${L.to}${L.parity ? ` (${L.parity})` : ''}`;
    else label = `${L.kind === 'row' ? 'Row' : 'Rnd'} ${L.from}`;
    let s = `${label}: ${this.items(r.items)}.`;
    if (r.count) s += ` ${this.count(r.count)}`;
    return s;
  }

  items(items: Item[]): string {
    return items.map((i) => this.item(i)).join(', ');
  }

  item(it: Item): string {
    switch (it.kind) {
      case 'stitch': {
        let s = it.count !== undefined && it.count !== 1 ? `${it.count} ` : '';
        s += this.stitchName(it.spec);
        if (it.loop && !it.target?.loop) s += ` ${it.loop}`;
        if (it.target) s += ` ${this.target(it.target)}`;
        if (it.times !== undefined && it.times !== 1) s += ` x${it.times}`;
        return s;
      }
      case 'chain': {
        let s = `ch ${it.n}`;
        const c = it.countsAs;
        if (c?.kind === 'counts') s += ` (counts as ${c.first ? 'first ' : ''}${this.n(c.type)}${c.extraCh ? `, ch ${c.extraCh}` : ''})`;
        else if (c?.kind === 'notCount') s += ' (does not count as st)';
        return s;
      }
      case 'skip':
        return `${skipWord(this.terms)} ${it.n} ${this.unit(it.unit, it.n)}`;
      case 'join':
        return it.target ? `join with ${this.n('slst')} ${this.target(it.target)}` : 'join';
      case 'ringJoin':
        return 'join to form ring';
      case 'ring':
        return 'mr';
      case 'turn':
        return 'turn';
      case 'otherSide':
        return 'working along the other side of the chain';
      case 'fasten':
        return 'fasten off';
      case 'group': {
        const close = it.bracket === '(' ? ')' : ']';
        let s = `${it.bracket}${this.items(it.items)}${close}`;
        if (it.target) s += ` ${this.target(it.target)}`;
        if (it.times) s += ` ${this.times(it.times)}`;
        return s;
      }
      case 'repeat':
        return `*${this.items(it.items)}* ${this.times(it.times)}`;
    }
  }

  times(t: Times): string {
    if (t.kind === 'n') return `x${t.n}`;
    return extentText(t.kind);
  }

  stitchName(s: StitchSpec): string {
    switch (s.kind) {
      case 'basic':
        return s.post ? `${s.post}${this.n(s.type)}` : this.n(s.type);
      case 'inc':
        return s.base === 'sc' ? 'inc' : `${this.n(s.base)} inc`;
      case 'tog':
        if (s.alias && s.base === 'sc' && s.n === 2 && !s.post) return s.alias;
        return `${s.post ?? ''}${this.n(s.base)}${s.n}tog`;
      case 'cluster':
        if (s.alias === 'bobble' && s.base === 'dc' && s.n === 5) return 'bobble';
        if (s.alias === 'cl' && s.base === 'dc' && s.n === 3) return 'cl';
        return `${s.n}-${this.n(s.base)} cl`;
      case 'puff':
        return s.explicit || s.loops !== 3 ? `${s.loops}-loop puff` : 'puff';
      case 'popcorn':
        return s.explicit || s.legs !== 5 ? `${s.legs}-${this.n(s.base)} pc` : 'pc';
      case 'picot':
        return s.chains === 3 ? 'picot' : `ch-${s.chains} picot`;
      case 'shell':
        return s.explicit || s.n !== 5 || s.base !== 'dc' ? `${s.n}-${this.n(s.base)} shell` : 'shell';
      case 'v':
        return 'v-st';
    }
  }

  target(t: Target): string {
    return `${t.prep} ${t.loop ? `${t.loop} of ` : ''}${this.place(t.place)}`;
  }

  place(p: Place): string {
    switch (p.kind) {
      case 'ring':
        return 'ring';
      case 'same':
        return `same ${this.unit(p.unit, 1)}`;
      case 'first':
        return `first ${this.unit(p.unit, 1)}`;
      case 'topOf':
        return p.what === 'tch' ? 'top of tch' : `top of beg ch${p.chains !== undefined ? `-${p.chains}` : ''}`;
      case 'next':
        // "3 sc in corner": the corner is always the next one
        if (p.unit.kind === 'corner' && (p.n ?? 1) === 1) return 'corner';
        return `next ${p.n !== undefined && p.n !== 1 ? `${p.n} ` : ''}${this.unit(p.unit, p.n ?? 1)}`;
      case 'each': {
        let s = 'each ';
        if (p.n !== undefined) s += `of next ${p.n} `;
        s += this.unit(p.unit, 1);
        if (p.extent) s += ` ${extentText(p.extent)}`;
        return s;
      }
      case 'fromHook':
        return `${ordinal(p.ordinal)} ch from hook`;
    }
  }

  unit(u: Unit, n: number): string {
    const pl = n !== 1;
    switch (u.kind) {
      case 'st':
        return pl ? 'sts' : 'st';
      case 'any':
        return 'place';
      case 'stname':
        if (u.type === 'cl') return 'cl';
        if (u.type === 'popcorn') return 'pc';
        return this.n(u.type);
      case 'space': {
        const w = u.word === 'loop' ? (pl ? 'loops' : 'loop') : pl ? 'sps' : 'sp';
        return u.chains !== undefined ? `ch-${u.chains} ${w}` : w;
      }
      case 'ch':
        return pl ? 'chs' : 'ch';
      case 'rowEnd':
        return pl ? 'row ends' : 'row end';
      case 'corner':
        return pl ? 'corners' : 'corner';
    }
  }

  count(c: CountAnn): string {
    return `(${c.parts.map((p) => this.countPart(p)).join(', ')})`;
  }

  countPart(p: CountPart): string {
    const u = p.unit;
    switch (u.kind) {
      case 'st':
        return p.text === '' ? `${p.n}` : `${p.n} sts`;
      case 'type':
        return `${p.n} ${u.type === 'popcorn' ? 'pc' : this.n(u.type)}`;
      case 'cl':
        return `${p.n} cl`;
      case 'spaces':
        return u.chains !== undefined ? `${p.n} ch-${u.chains} sps` : `${p.n} ch-sps`;
      case 'group':
        return `${p.n} ${u.group === 'shell' ? 'shells' : 'v-sts'}`;
      case 'unknown':
        return `${p.n} ${p.text}`;
    }
  }
}

function extentText(e: Extent): string {
  return e === 'end' ? 'to end' : e === 'corner' ? 'across to corner' : e;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}
