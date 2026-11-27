import type { IconName } from '@/ui';

export type NavItem = {
  /** feature folder name under src/features (also the route's first segment, except gallery) */
  key: string;
  path: string;
  label: string;
  /** label in the phone tab bar / "More" sheet */
  short?: string;
  icon: IconName;
  blurb: string;
  /** takes an optional :id (pattern) param */
  takesPattern?: boolean;
  /** shown in the phone bottom bar; the rest go under "More" */
  primary?: boolean;
};

export const NAV: NavItem[] = [
  { key: 'gallery', path: '/', label: 'Home', icon: 'home', primary: true, blurb: 'Demos and examples' },
  { key: 'library', path: '/library', label: 'Library', icon: 'library', primary: true, blurb: 'Your patterns and the built-ins' },
  { key: 'editor', path: '/editor', label: 'Editor', icon: 'edit', takesPattern: true, primary: true, blurb: 'Write notation with live stitch-count checks' },
  { key: 'chart', path: '/chart', label: 'Chart', icon: 'chart', takesPattern: true, blurb: 'Radial symbol chart, round by round' },
  { key: 'sim', path: '/sim', label: '3D view', short: '3D', icon: 'cube', takesPattern: true, blurb: 'Physics preview: will it lie flat, cup or ruffle?' },
  { key: 'designer', path: '/designer?kind=doily', label: 'Designer', icon: 'sparkle', blurb: 'Generate doily patterns from a few choices' },
  { key: 'snowflake', path: '/designer?kind=snowflake', label: 'Snowflakes', icon: 'sparkle', blurb: 'Pointed lace snowflakes with a printable blocking template' },
  { key: 'blanket', path: '/blanket', label: 'Blankets', icon: 'grid', blurb: 'Blanket design studio: rows with a fitted border, in the round, motifs' },
  { key: 'counter', path: '/counter', label: 'Counter', icon: 'counter', takesPattern: true, primary: true, blurb: 'Big-button row counter that follows the pattern' },
  { key: 'amigurumi', path: '/amigurumi', label: 'Amigurumi', icon: 'ami', blurb: 'Shapes of revolution and gauge maths' },
  { key: 'about', path: '/about', label: 'About & settings', short: 'About', icon: 'info', blurb: 'What this is; your data; settings' },
];

export const navByKey = Object.fromEntries(NAV.map((n) => [n.key, n])) as Record<string, NavItem>;
