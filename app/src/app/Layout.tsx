import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BrandMark, Dialog, Icon, IconButton, Toaster } from '@/ui';
import { useSettings, type ThemePref } from '@/store/settings';
import { NAV, type NavItem } from './nav';

const nextTheme: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const themeIcon = { system: 'auto', light: 'sun', dark: 'moon' } as const;
const themeLabel = { system: 'Theme: follow system', light: 'Theme: light', dark: 'Theme: dark' };

export function ThemeButton() {
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  return <IconButton icon={themeIcon[theme]} label={`${themeLabel[theme]} (click to change)`} onClick={() => set({ theme: nextTheme[theme] })} />;
}

function activeKey(pathname: string): string {
  const seg = pathname.split('/')[1] ?? '';
  return seg === '' ? 'gallery' : seg;
}

function Brand() {
  return (
    <Link to="/" className="shell-brand" aria-label="Crochet Tools — home">
      <span className="shell-brand__mark"><BrandMark size={30} /></span>
      <span className="shell-brand__name">Crochet Tools</span>
    </Link>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link to={item.path} className="shell-side__link" aria-current={active ? 'page' : undefined}>
      <Icon name={item.icon} size={20} />
      <span>{item.label}</span>
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const key = activeKey(pathname);
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAV.filter((n) => n.primary);
  const more = NAV.filter((n) => !n.primary);
  const moreActive = more.some((n) => n.key === key);
  const current = NAV.find((n) => n.key === key);

  return (
    <div className="shell">
      <a className="shell-skip" href="#main">Skip to content</a>

      {/* desktop sidebar */}
      <aside className="shell-side">
        <Brand />
        <nav className="shell-side__nav" aria-label="Main">
          {NAV.filter((n) => n.key !== 'about').map((n) => <SideLink key={n.key} item={n} active={n.key === key} />)}
        </nav>
        <div className="shell-side__foot">
          <SideLink item={NAV.find((n) => n.key === 'about')!} active={key === 'about'} />
          <ThemeButton />
        </div>
      </aside>

      {/* phone top bar */}
      <header className="shell-top">
        <Brand />
        <span className="shell-top__title">{current && current.key !== 'gallery' ? current.short ?? current.label : ''}</span>
        <ThemeButton />
      </header>

      <main id="main" className="shell-main" tabIndex={-1}>{children}</main>

      {/* phone tab bar */}
      <nav className="shell-tabs" aria-label="Main">
        {primary.map((n) => (
          <Link key={n.key} to={n.path} className="shell-tabs__tab" aria-current={n.key === key ? 'page' : undefined}>
            <Icon name={n.icon} size={22} />
            <span>{n.short ?? n.label}</span>
          </Link>
        ))}
        <button type="button" className="shell-tabs__tab" aria-current={moreActive ? 'page' : undefined} aria-haspopup="dialog" onClick={() => setMoreOpen(true)}>
          <Icon name="grid" size={22} />
          <span>More</span>
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More tools" sheet>
        <div className="shell-more">
          {more.map((n) => (
            <Link key={n.key} to={n.path} className="shell-more__item" onClick={() => setMoreOpen(false)} aria-current={n.key === key ? 'page' : undefined}>
              <span className="shell-more__icon"><Icon name={n.icon} size={22} /></span>
              <span>
                <strong>{n.label}</strong>
                <span className="muted small">{n.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </Dialog>

      <Toaster />
    </div>
  );
}
