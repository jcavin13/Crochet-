import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react';
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Button, EmptyState, buttonClass } from '@/ui';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { Layout } from './Layout';

// Each feature is a lazily loaded page: src/features/<name>/index.tsx, default export.
const page = (load: () => Promise<{ default: ComponentType }>) => lazy(load);
const Gallery = page(() => import('@/features/gallery/index.tsx'));
const Library = page(() => import('@/features/library/index.tsx'));
const Editor = page(() => import('@/features/editor/index.tsx'));
const Chart = page(() => import('@/features/chart/index.tsx'));
const Sim = page(() => import('@/features/sim/index.tsx'));
const Designer = page(() => import('@/features/designer/index.tsx'));
const Counter = page(() => import('@/features/counter/index.tsx'));
const Amigurumi = page(() => import('@/features/amigurumi/index.tsx'));
const About = page(() => import('@/features/about/index.tsx'));

class RouteErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[route] crashed', error); }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        title="This page hit a snag"
        actions={<><Button onClick={() => this.setState({ error: undefined })}>Try again</Button><Link className={buttonClass('primary')} to="/">Go home</Link></>}
      >
        {this.state.error.message || 'Something went wrong while drawing this page.'} Your patterns are safe — they are stored separately.
      </EmptyState>
    );
  }
}

function PageLoading() {
  return <div className="shell-loading" role="progressbar" aria-label="Loading"><span /></div>;
}

function NotFound() {
  return <EmptyState title="Nothing on this page" actions={<Link className={buttonClass('primary')} to="/">Back to the gallery</Link>}>That link doesn't lead anywhere in Crochet Tools.</EmptyState>;
}

function useThemeEffect() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    const syncMeta = () => {
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    };
    syncMeta();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', syncMeta);
    return () => mq?.removeEventListener('change', syncMeta);
  }, [theme]);
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function RoutedApp() {
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1] ?? '';
  return (
    <Layout>
      <ScrollToTop />
      <RouteErrorBoundary resetKey={seg}>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Gallery />} />
            <Route path="/library" element={<Library />} />
            <Route path="/editor/:id?" element={<Editor />} />
            <Route path="/chart/:id?" element={<Chart />} />
            <Route path="/sim/:id?" element={<Sim />} />
            <Route path="/designer" element={<Designer />} />
            <Route path="/counter/:id?" element={<Counter />} />
            <Route path="/amigurumi" element={<Amigurumi />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </Layout>
  );
}

export function App() {
  useThemeEffect();
  useEffect(() => {
    void useLibrary.getState().hydrate();
    const flush = () => { void useLibrary.getState().flush(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onHide); };
  }, []);
  return (
    <HashRouter>
      <RoutedApp />
    </HashRouter>
  );
}
