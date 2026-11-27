// A few line icons the shared set does not have (same 24-unit grid and stroke as @/ui icons).
import type { SVGProps } from 'react';

function Svg({ size = 20, d, ...rest }: { size?: number; d: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={d} />
    </svg>
  );
}
export const LockIcon = ({ size, open }: { size?: number; open?: boolean }) =>
  <Svg size={size} d={open ? 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 5.8-1' : 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3'} />;
export const UndoIcon = ({ size }: { size?: number }) => <Svg size={size} d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />;
export const RedoIcon = ({ size }: { size?: number }) => <Svg size={size} d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />;
export const PrintIcon = ({ size }: { size?: number }) => <Svg size={size} d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" />;
export const SnowIcon = ({ size }: { size?: number }) => <Svg size={size} d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5" />;
