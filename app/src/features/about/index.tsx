import { Card, Page, PageHeader, Section, SegmentedControl, Select, ShapeBadge } from '@/ui';
import { compilerAvailable } from '@/app/coreApi';
import { useAllPatterns, useStitchParams } from '@/app/hooks';
import { useSettings, type ThemePref, type Terms } from '@/store/settings';
import { MyYarnsManager } from '@/features/yarn/MyYarns';
import type { ParamSet } from '@/core/params';
import './about.css';

const DOCS: [string, string][] = [
  ['docs/architecture.md', 'How the pieces fit: one stitch graph, many views'],
  ['spec/notation.md', 'The pattern notation — grammar, meaning, error messages'],
  ['spec/pattern.schema.json', 'The stitch-graph format behind .crochet.json files'],
  ['spec/flatness.md', 'The per-round flat / cup / ruffle rule'],
  ['spec/physics.md', 'The spring model behind the 3D view'],
  ['spec/stitch_params.json', 'Stitch sizes per yarn and hook'],
  ['spec/yarn.md', 'How the yarn estimates are worked out, and how uncertain they are'],
  ['data/', 'Public-domain patterns transcribed into the notation'],
];

export default function AboutPage() {
  const s = useSettings();
  const params = useStitchParams();
  const { mine } = useAllPatterns();
  return (
    <Page>
      <PageHeader title="About & settings" description="Crochet Tools is a set of small, careful tools for crocheters — lace and doilies first." />

      <div className="about-grid">
        <div className="about-prose">
          <Section title="What this is">
            <p>
              A crochet pattern is a program for your hands. Crochet Tools reads one written in ordinary
              pattern language — <code>Rnd 3: *sc, inc* x6. (18)</code> — and turns it into a <em>stitch
              graph</em>: every stitch, what it is worked into, and every chain space. Each tool is a view
              of that graph.
            </p>
            <ul>
              <li><strong>Editor</strong> — checks counts and structure as you type, pointing at the exact place a round goes wrong.</li>
              <li><strong>Chart</strong> — a radial symbol chart, plus a per-round flatness check.</li>
              <li><strong>3D view</strong> — a spring simulation showing whether the piece will lie <ShapeBadge shape="flat">flat</ShapeBadge>, <ShapeBadge shape="cup">cup</ShapeBadge> or <ShapeBadge shape="ruffle">ruffle</ShapeBadge>.</li>
              <li><strong>Designer</strong> and <strong>Amigurumi</strong> — generate patterns from a few choices.</li>
              <li><strong>Counter</strong> — follow along row by row at the sofa.</li>
            </ul>
          </Section>

          <Section title="Your data stays here">
            <p>
              There is no server and no account. Your patterns and counter progress are stored only in this
              browser on this device (IndexedDB); settings use local storage. Nothing is uploaded, and there
              are no analytics. Clearing the site's data in your browser deletes your patterns — use
              <strong> Download .cro</strong> in the Library to keep copies or move them to another device.
            </p>
            <p className="muted small">
              {mine.length} pattern{mine.length === 1 ? '' : 's'} of your own stored in this browser.
              Installed as an app, it works fully offline.
            </p>
          </Section>

          <Section title="My yarns" id="yarns">
            <p className="muted small">
              Yarn estimates (Editor, Counter, Amigurumi, designers) use these: your ball band's metres per 100 g and ball
              size, and — once you weigh a swatch — your own calibration. Without one, an estimate is a nominal ±20 %.
            </p>
            <MyYarnsManager appParams={params.selected as unknown as ParamSet} />
          </Section>

          <Section title="Documentation">
            <p className="muted small">In the project's GitHub repository:</p>
            <dl className="about-docs">
              {DOCS.map(([path, what]) => (
                <div key={path}><dt><code>{path}</code></dt><dd>{what}</dd></div>
              ))}
            </dl>
          </Section>
        </div>

        <Card className="about-settings">
          <h2>Settings</h2>
          <div className="about-setting">
            <span className="about-setting__label">Appearance</span>
            <SegmentedControl<ThemePref>
              label="Appearance"
              value={s.theme}
              onChange={(theme) => s.set({ theme })}
              options={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
            />
          </div>
          <div className="about-setting">
            <span className="about-setting__label">Stitch terms</span>
            <SegmentedControl<Terms>
              label="Stitch terms"
              value={s.terms}
              onChange={(terms) => s.set({ terms })}
              options={[{ value: 'US', label: 'US' }, { value: 'UK', label: 'UK' }]}
            />
            <span className="muted small">Used when showing and printing patterns. Each pattern's own <code>terms:</code> line decides how it is read.</span>
          </div>
          <div className="about-setting">
            <Select
              label="Yarn & hook (stitch sizes)"
              value={params.setting}
              onChange={(e) => params.setSelectedId(e.target.value)}
              hint="Used by the flatness check and the 3D view."
            >
              <option value="auto">Automatic — the pattern's params, else {params.sets.find((x) => x.id === params.defaultSetId)?.label}</option>
              {params.sets.map((set) => <option key={set.id} value={set.id}>{set.label}</option>)}
            </Select>
          </div>
          <div className="about-setting">
            <span className="about-setting__label">Yarn units</span>
            <SegmentedControl<'metric' | 'imperial'>
              label="Yarn units"
              value={s.yarnUnits ?? 'metric'}
              onChange={(yarnUnits) => s.set({ yarnUnits })}
              options={[{ value: 'metric', label: 'Metres · grams' }, { value: 'imperial', label: 'Yards · ounces' }]}
            />
          </div>
          <hr />
          <p className="muted small" style={{ margin: 0 }}>
            Notation checker: {compilerAvailable ? 'ready' : 'not available yet'} · version 0.1
          </p>
        </Card>
      </div>
    </Page>
  );
}
