// App settings. Kept in localStorage (small, synchronous — the theme must be known before first paint).
import { create } from 'zustand';

export type ThemePref = 'system' | 'light' | 'dark';
export type Terms = 'US' | 'UK';

export type Settings = {
  theme: ThemePref;
  /** Terminology for displaying/printing notation (the graph is always US). */
  terms: Terms;
  /** Stitch-parameter set id from spec/stitch_params.json, or 'auto' = the pattern's `params:` header, else the default set. */
  paramsSet: string;
  /** Last pattern opened in any feature; routes without :id fall back to it. */
  lastPatternId?: string;
  /** Units for yarn amounts: metres and grams, or yards and ounces. */
  yarnUnits?: 'metric' | 'imperial';
};

export const SETTINGS_KEY = 'crochet-tools:settings';
export const defaultSettings: Settings = { theme: 'system', terms: 'US', paramsSet: 'auto' };

function load(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* private mode, corrupt JSON */ }
  return { ...defaultSettings };
}

function save(s: Settings) {
  try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

type SettingsState = Settings & { set: (patch: Partial<Settings>) => void; reset: () => void };

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { set: _s, reset: _r, ...data } = get();
    save(data);
  },
  reset: () => { set({ ...defaultSettings }); save(defaultSettings); },
}));
