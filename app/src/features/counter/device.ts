// Device helpers for the counter: screen wake lock, haptic tick, soft click sound, tap/swipe zone.
// Everything degrades gracefully: unsupported APIs are reported, never thrown.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';

/* ------------------------------------------------------------------ wake lock */

export type WakeStatus = 'off' | 'on' | 'pending' | 'unsupported' | 'denied';

type Sentinel = { released: boolean; release: () => Promise<void>; addEventListener: (t: 'release', cb: () => void) => void };
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> };

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/** Keep the screen on while `enabled`; re-acquired when the page becomes visible again. */
export function useWakeLock(enabled: boolean): WakeStatus {
  const [status, setStatus] = useState<WakeStatus>(() => (wakeLockSupported() ? 'off' : 'unsupported'));
  const sentinel = useRef<Sentinel | null>(null);
  useEffect(() => {
    if (!wakeLockSupported()) { setStatus('unsupported'); return; }
    if (!enabled) { setStatus('off'); return; }
    let cancelled = false;
    const api = (navigator as unknown as { wakeLock: WakeLockApi }).wakeLock;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel.current && !sentinel.current.released)) return;
      setStatus('pending');
      try {
        const s = await api.request('screen');
        if (cancelled) { void s.release(); return; }
        sentinel.current = s;
        setStatus('on');
        s.addEventListener('release', () => { if (!cancelled) setStatus(document.visibilityState === 'visible' ? 'off' : 'pending'); });
      } catch {
        if (!cancelled) setStatus('denied');
      }
    };
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      const s = sentinel.current;
      sentinel.current = null;
      if (s && !s.released) void s.release().catch(() => {});
    };
  }, [enabled]);
  return status;
}

/* ------------------------------------------------------------------ haptics & sound */

export const vibrateSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function vibrate(pattern: number | number[]) {
  try { if (vibrateSupported()) navigator.vibrate(pattern); } catch { /* ignore */ }
}

let audio: AudioContext | null = null;
export const audioSupported = () => typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);

/** A short soft click (or a two-note chime at the end of a round). Must follow a user gesture. */
export function click(kind: 'tick' | 'round' = 'tick') {
  try {
    if (!audioSupported()) return;
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    audio ??= new Ctor();
    if (audio.state === 'suspended') void audio.resume();
    const t0 = audio.currentTime;
    const notes = kind === 'tick' ? [[1650, 0, 0.035]] : [[880, 0, 0.12], [1320, 0.11, 0.18]];
    for (const [f, at, dur] of notes) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(kind === 'tick' ? 0.08 : 0.12, t0 + at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(audio.destination);
      o.start(t0 + at);
      o.stop(t0 + at + dur + 0.02);
    }
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ tap / swipe zone */

/**
 * Pointer handlers for a big tap zone: a tap (little movement) calls onTap, a horizontal swipe
 * calls onSwipe(-1 = left, +1 = right). Taps on interactive children are ignored.
 */
export function useTapSwipe(onTap: () => void, onSwipe: (dir: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number; id: number; t: number } | null>(null);
  const onPointerDown = useCallback((e: RPointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [data-no-tap]')) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
  }, []);
  const onPointerUp = useCallback((e: RPointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > 1.6 * Math.abs(dy)) { onSwipe(dx < 0 ? -1 : 1); return; }
    if (Math.hypot(dx, dy) < 14 && performance.now() - s.t < 900) onTap();
  }, [onTap, onSwipe]);
  const onPointerCancel = useCallback(() => { start.current = null; }, []);
  return { onPointerDown, onPointerUp, onPointerCancel };
}

/** True when the user asked for reduced motion. */
export function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [v, setV] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

/** Global key handler that ignores typing in fields and open dialogs. */
export function useKeys(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('dialog[open]'))) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.altKey || e.metaKey) return;
      ref.current(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}
