// A few counter-specific stroke icons (same 24×24 style as ui/icons.tsx).
const paths = {
  back: 'M19 12H5M11 6l-6 6 6 6',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  screen: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  'screen-on': 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2M12 8v1.2M12 13.8V15M9.2 11.5h1.2M13.6 11.5h1.2M10 9.5l.8.8M13.2 12.7l.8.8M14 9.5l-.8.8M10.8 12.7l-.8.8',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  tally: 'M5 5v14M9 5v14M13 5v14M17 5v14M3 15l18-6',
} as const;
export type CtrIconName = keyof typeof paths;

export function CtrIcon({ name, size = 22 }: { name: CtrIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
