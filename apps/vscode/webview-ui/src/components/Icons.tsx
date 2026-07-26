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

export function IconSettings(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v1.25M8 13.25V14.5M1.5 8h1.25M13.25 8H14.5M3.4 3.4l.88.88M11.72 11.72l.88.88M3.4 12.6l.88-.88M11.72 4.28l.88-.88" />
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
