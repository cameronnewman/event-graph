// Tiny inline SVG set. Avoiding a dep — we only need a handful.

import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(p: Props) {
  return (
    <Svg {...p}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </Svg>
  );
}

export function LoopIcon(p: Props) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3.51-7.13" />
      <polyline points="21 4 21 9 16 9" />
    </Svg>
  );
}

export function TaskIcon(p: Props) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

export function CircleIcon(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
    </Svg>
  );
}

export function ChevronRightIcon(p: Props) {
  return (
    <Svg {...p}>
      <polyline points="9 6 15 12 9 18" />
    </Svg>
  );
}

export function ChevronDownIcon(p: Props) {
  return (
    <Svg {...p}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}

export function LockIcon(p: Props) {
  return (
    <Svg {...p}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function EyeIcon(p: Props) {
  return (
    <Svg {...p}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function iconForEventType(type: string) {
  if (type === 'execution.start') return PlayIcon;
  if (type === 'loop.iteration') return LoopIcon;
  if (type === 'task.run') return TaskIcon;
  return CircleIcon;
}

export function colorForEventType(type: string): string {
  if (type === 'execution.start') return 'text-sky-600';
  if (type === 'loop.iteration') return 'text-amber-600';
  if (type === 'task.run') return 'text-slate-500';
  return 'text-slate-400';
}
