import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const defaults: IconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function IconChat(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H9l-2.5 2v-2h-4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.5l2.25 1.25" />
    </svg>
  );
}

/** Classic gear — used for Settings. */
export function IconSettings(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M6.4 1.9h3.2l.4 1.5c.35.12.68.28.98.48l1.5-.55 1.6 1.6-.55 1.5c.2.3.36.63.48.98l1.5.4v3.2l-1.5.4c-.12.35-.28.68-.48.98l.55 1.5-1.6 1.6-1.5-.55c-.3.2-.63.36-.98.48l-.4 1.5H6.4l-.4-1.5a4.8 4.8 0 0 1-.98-.48l-1.5.55-1.6-1.6.55-1.5a4.8 4.8 0 0 1-.48-.98l-1.5-.4V6.4l1.5-.4c.12-.35.28-.68.48-.98l-.55-1.5 1.6-1.6 1.5.55c.3-.2.63-.36.98-.48l.4-1.5z" />
      <circle cx="8" cy="8" r="2.1" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function IconSkills(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 12.5 8 3.5l5 9H3z" />
      <path d="M5.5 9.5h5" />
    </svg>
  );
}

export function IconIndex(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 3.5h10v9H3z" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <rect x="5.5" y="5.5" width="7" height="8" rx="1" />
      <path d="M3.5 10.5v-6a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M2.5 8h9.5M8.5 4.5 12.5 8 8.5 11.5" />
    </svg>
  );
}

export function IconAsk(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.4 6.2a1.7 1.7 0 0 1 3.2.9c0 1.1-1.6 1.4-1.6 2.4" />
      <path d="M8 11.6h.01" />
    </svg>
  );
}

export function IconPlan(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 3.5h9v9h-9z" />
      <path d="M5.5 6h5M5.5 8.25h5M5.5 10.5h3" />
    </svg>
  );
}

export function IconAgent(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 11.5 8 3.5l4 8" />
      <path d="M5.5 9.5h5" />
      <circle cx="8" cy="12.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconReview(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 4.5h4v8h-4zM8.5 4.5h4v8h-4z" />
      <path d="M5 7h1.5M5 9h1.5M10 7h1.5M10 9h1.5" />
    </svg>
  );
}

export function IconSafe(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M8 2.5 12.5 4.5v3.2c0 3-1.9 5.3-4.5 6.3-2.6-1-4.5-3.3-4.5-6.3V4.5L8 2.5z" />
    </svg>
  );
}

export function IconGuided(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5 12.5V7.5a3 3 0 0 1 6 0v5" />
      <path d="M3.5 12.5h9" />
      <path d="M8 3.5v1.5" />
    </svg>
  );
}

export function IconBuilder(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 12.5h9" />
      <path d="M5 12.5V8.5l3-3 3 3v4" />
      <path d="M7 12.5v-2h2v2" />
    </svg>
  );
}

export function IconPilot(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M8 2.5 13 13.5H3L8 2.5z" />
      <path d="M8 6.5v3.5" />
    </svg>
  );
}

export function IconDepthAuto(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M8 2.5 12.5 8 8 13.5 3.5 8 8 2.5z" />
      <circle cx="8" cy="8" r="1.25" />
    </svg>
  );
}

export function IconDepthQuick(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M6 3.5 11.5 8 6 12.5" />
      <path d="M3.5 3.5 9 8 3.5 12.5" />
    </svg>
  );
}

export function IconDepthDeep(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M2.5 5.5h11" />
      <path d="M4 8h8" />
      <path d="M5.5 10.5h5" />
      <path d="M7 13h2" />
    </svg>
  );
}
