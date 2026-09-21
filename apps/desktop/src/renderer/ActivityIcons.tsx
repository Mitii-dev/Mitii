/** SVG icons for the Code-mode activity bar (VS Code–scale). */

import type { ReactNode } from 'react';

type IconProps = { size?: number; className?: string };

function Svg(props: IconProps & { children: ReactNode }) {
  const size = props.size ?? 24;
  return (
    <svg
      className={props.className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {props.children}
    </svg>
  );
}

export function IconFiles(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </Svg>
  );
}

export function IconGit(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="18" cy="6" r="2.25" />
      <circle cx="12" cy="18" r="2.25" />
      <path d="M6 8.25v3.5a3 3 0 0 0 3 3h3" />
      <path d="M18 8.25v1.5a3 3 0 0 1-3 3h-1.5" />
    </Svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H7l-4 2.25V12A8.5 8.5 0 1 1 21 12z" />
      <path d="M8.5 11.5h7" />
      <path d="M8.5 14.5h4.5" />
    </Svg>
  );
}

export function IconCode(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 7 4.5 12 9 17" />
      <path d="M15 7l4.5 5L15 17" />
    </Svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 6.5l1.6 1.5M17.8 16l1.6 1.5M2.5 12h2.2M19.3 12h2.2M4.6 17.5l1.6-1.5M17.8 8l1.6-1.5" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

export function IconMcp(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="8" width="7" height="8" rx="1.5" />
      <rect x="14" y="8" width="7" height="8" rx="1.5" />
      <path d="M10 12h4" />
      <path d="M6.5 8V6.5a2 2 0 0 1 2-2h0" />
      <path d="M17.5 8V6.5a2 2 0 0 0-2-2h0" />
    </Svg>
  );
}

export function IconSkills(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 14.5 9.5 21 12 14.5 14.5 12 21 9.5 14.5 3 12 9.5 9.5z" />
    </Svg>
  );
}

export function IconRecipes(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8" />
      <path d="M8 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" />
      <path d="M11 8h5" />
      <path d="M11 12h5" />
      <path d="M11 16h3" />
    </Svg>
  );
}

export function IconProvider(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" />
      <path d="m5.6 5.6 1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </Svg>
  );
}

export function IconAutocomplete(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h10" />
      <path d="M4 17h7" />
      <path d="M16 14v6" />
      <path d="M13.5 17.5 16 15l2.5 2.5" />
    </Svg>
  );
}

export function IconWorkspace(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 9.5 12 4l9 5.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M9 21V12h6v9" />
    </Svg>
  );
}

export function IconModes(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="12" r="3" />
      <circle cx="17" cy="12" r="3" />
      <path d="M10 12h4" />
    </Svg>
  );
}

export function IconContext(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8" />
      <path d="M8 12h8" />
      <path d="M8 15h5" />
    </Svg>
  );
}

export function IconFeatures(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M5 8.5 7.5 10" />
      <path d="M16.5 14 19 15.5" />
      <path d="M5 15.5 7.5 14" />
      <path d="M16.5 10 19 8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </Svg>
  );
}

export function IconDeveloper(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 8 4 12l4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m14 7-4 10" />
    </Svg>
  );
}
