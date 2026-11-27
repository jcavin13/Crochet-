import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Icon, Page, Section, ShapeBadge, buttonClass } from '@/ui';
import { builtinById, corpus, fixtures, type BuiltinRecord } from '@/app/builtins';
import { patternHref } from '@/app/hooks';
import { NAV } from '@/app/nav';
import { PatternGlyph } from '@/app/PatternGlyph';
import { declaredCounts, readHeaders } from '@/store/text';
import './gallery.css';

const TOOL_TEXT: Record<string, string> = {
  editor: 'Type a pattern the way it is written in English. Every round is checked as you type — stitch counts, chain spaces, repeats — with the exact place a problem starts.',
  chart: 'The same pattern drawn as a radial symbol chart, the way doily charts are printed, with a per-round flatness check: will this round lie flat, cup or ruffle?',
  sim: 'A physics preview: the stitches become springs and the piece relaxes into its 3D shape, relaxed or blocked.',
  designer: 'Build a doily layer by layer with suggestions for what fits next; chain lengths, stitch counts and increases are solved so every round lies flat.',
  snowflake: 'Six-pointed (or 5, 8, 12) thread snowflakes with picot, trefoil and fern arms — checked by how they block, with a pin-out template to print.',
  counter: 'For the sofa: one big button, the instruction you are on in large type, and your place remembered on this device.',
  amigurumi: 'Spheres, cones and custom profiles turned into round-by-round counts for your gauge.',
};

export default function GalleryPage() {
  const hero = builtinById['fixture:simple_doily'] ?? fixtures[0];
  const tools = NAV.filter((n) => TOOL_TEXT[n.key]);
  return (
    <Page className="gal">
      <section className="gal-hero">
        <div className="gal-hero__text">
          <p className="gal-hero__kicker">Lace &amp; doilies first</p>
          <h1 className="gal-hero__title">Check every stitch before you pick up the hook.</h1>
          <p className="gal-hero__lede">
            Write a crochet pattern in plain notation and see it checked round by round, charted, and shaped in 3D.
            Everything runs in your browser and works offline; your patterns never leave this device.
          </p>
          <div className="row">
            <Link className={buttonClass('primary')} to={hero ? patternHref('editor', hero.id) : '/editor'}><Icon name="edit" size={18} />Try the editor</Link>
            <Link className={buttonClass()} to="/library"><Icon name="library" size={18} />Your library</Link>
          </div>
        </div>
        {hero && (
          <div className="gal-hero__art" aria-hidden="true">
            <PatternGlyph text={hero.text} size={260} />
          </div>
        )}
      </section>

      <Section title="Tools">
        <div className="gal-tools">
          {tools.map((t) => (
            <Link key={t.key} to={t.path} className="gal-tool">
              <span className="gal-tool__icon"><Icon name={t.icon} size={22} /></span>
              <span className="gal-tool__body">
                <span className="gal-tool__name">{t.label}</span>
                <span className="gal-tool__text">{TOOL_TEXT[t.key]}</span>
              </span>
              <Icon name="chevron-right" className="gal-tool__chev" />
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Example patterns" actions={<span className="muted small">Read-only — open one in the Editor and start typing to make it yours.</span>}>
        <div className="gal-patterns">
          {fixtures.map((p) => <PatternCard key={p.id} p={p} />)}
        </div>
      </Section>

      <Section title="From the corpus">
        {corpus.length ? (
          <div className="gal-patterns">
            {corpus.map((p) => <PatternCard key={p.id} p={p} />)}
          </div>
        ) : (
          <Card className="gal-corpus-empty">
            <p className="muted" style={{ margin: 0 }}>
              Public-domain patterns transcribed into the notation will appear here as they are added to <code>data/corpus/</code>.
            </p>
          </Card>
        )}
      </Section>
    </Page>
  );
}

function PatternCard({ p }: { p: BuiltinRecord }) {
  const { counts, h } = useMemo(() => ({ counts: declaredCounts(p.text), h: readHeaders(p.text) }), [p.text]);
  const last = [...counts].reverse().find((n) => n != null);
  return (
    <Card flush interactive className="gal-card">
      <Link to={patternHref('editor', p.id)} className="gal-card__top">
        <span className="gal-card__glyph"><PatternGlyph text={p.text} size={108} /></span>
        <span className="gal-card__head">
          <span className="gal-card__title">{p.title}</span>
          <span className="gal-card__meta">
            {counts.length} rounds{last != null && <> · {last} sts</>}
            {h.yarn && <><br />{h.yarn}{h.hook && `, ${h.hook}`}</>}
          </span>
          <span className="row">
            {p.expectedShape && <ShapeBadge shape={p.expectedShape} />}
            {p.origin === 'corpus' && <Badge tone="outline">{p.license ?? 'public domain'}</Badge>}
          </span>
        </span>
      </Link>
      <div className="gal-card__actions" role="group" aria-label={`Open ${p.title} in`}>
        <Link to={patternHref('editor', p.id)}><Icon name="edit" size={16} />Editor</Link>
        <Link to={patternHref('chart', p.id)}><Icon name="chart" size={16} />Chart</Link>
        <Link to={patternHref('sim', p.id)}><Icon name="cube" size={16} />3D</Link>
        <Link to={patternHref('counter', p.id)}><Icon name="counter" size={16} />Counter</Link>
      </div>
    </Card>
  );
}
