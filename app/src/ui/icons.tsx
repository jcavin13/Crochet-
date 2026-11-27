// Small stroke icon set (24×24 grid, currentColor). Hand-drawn for this app; no icon dependency.
import type { SVGProps } from 'react';

export type IconName =
  | 'home' | 'library' | 'edit' | 'chart' | 'cube' | 'sparkle' | 'counter' | 'ami' | 'info'
  | 'sun' | 'moon' | 'auto' | 'plus' | 'search' | 'upload' | 'download' | 'trash' | 'copy'
  | 'more' | 'close' | 'check' | 'alert' | 'error' | 'chevron-right' | 'chevron-left' | 'grid' | 'hook';

const paths: Record<IconName, string> = {
  home: 'M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5z',
  library: 'M5 4h3v16H5zM10 4h3v16h-3zM15.2 4.6l2.9-.8 3.9 15.4-2.9.8z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  chart: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  counter: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6M12 9v7M9 16h6',
  ami: 'M12 21c-4.4 0-7-3-7-7 0-4.6 3.2-9 7-9s7 4.4 7 9c0 4-2.6 7-7 7zM8 5.5L6.5 3M16 5.5L17.5 3M9.5 11h.01M14.5 11h.01',
  info: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 11v5M12 8h.01',
  sun: 'M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  auto: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 3v18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4.5 4.5',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  error: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM9 9l6 6M15 9l-6 6',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-left': 'M15 5l-7 7 7 7',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  hook: 'M16 3v11a4 4 0 0 1-8 0v-1.5M8 12.5L10.5 15',
};

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const sw = name === 'more' ? 3.2 : 1.7;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
