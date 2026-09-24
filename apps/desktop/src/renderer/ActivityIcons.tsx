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

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16.5 16.5 21 21" />
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

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
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

/** Arrows for switching workspace / profile. */
export function IconSwitch(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 7h11" />
      <path d="m14 3 4 4-4 4" />
      <path d="M17 17H6" />
      <path d="m10 13-4 4 4 4" />
    </Svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.6-3.2 4-4.8 7-4.8s5.4 1.6 7 4.8" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7 7.5 19a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1L17.5 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
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

/** View-title / tree icons — 16px VS Code codicon silhouettes. */

function Svg16(props: IconProps & { children: ReactNode }) {
  const size = props.size ?? 16;
  return (
    <svg
      className={props.className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {props.children}
    </svg>
  );
}

/** Codicon-like: new-file */
export function IconNewFile(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M2.5 1.5h6.2L13.5 6.3V14.5H2.5z" />
      <path d="M8.5 1.5v5h5" />
      <path d="M5.5 10.5h5" />
      <path d="M8 8v5" />
    </Svg16>
  );
}

/** Codicon-like: new-folder */
export function IconNewFolder(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M1.5 3.5h4.2l1.3 1.5H14.5v8H1.5z" />
      <path d="M6.5 9.5h5" />
      <path d="M9 7v5" />
    </Svg16>
  );
}

/** Codicon-like: refresh */
export function IconRefresh(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.6" />
      <path d="M13.5 2.5v3.2h-3.2" />
    </Svg16>
  );
}

/** Codicon-like: collapse-all */
export function IconCollapseAll(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M2 3.5h12" />
      <path d="M2 8h12" />
      <path d="M2 12.5h12" />
      <path d="m5.5 6.2 2.5 2.3 2.5-2.3" />
    </Svg16>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg16 {...props} size={props.size ?? 12}>
      <path d="m6 3.5 4 4.5-4 4.5" />
    </Svg16>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg16 {...props} size={props.size ?? 12}>
      <path d="m3.5 6 4.5 4 4.5-4" />
    </Svg16>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M1.5 3.5h4.2l1.3 1.5H14.5v8H1.5z" />
    </Svg16>
  );
}

export function IconFolderOpen(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M1.5 4h4l1.2 1.4H10" />
      <path d="M1.5 13.5 3.2 7h11.3l-1.5 6.5z" />
    </Svg16>
  );
}

export function IconFile(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M3 1.5h6.2L13.5 5.8V14.5H3z" />
      <path d="M9 1.5v4.5h4.5" />
    </Svg16>
  );
}

export function IconEllipsis(props: IconProps) {
  return (
    <Svg16 {...props} size={props.size ?? 12}>
      <circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </Svg16>
  );
}

/** Codicon-like: eye / view */
export function IconEye(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M1.5 8s2.8-4.5 6.5-4.5S14.5 8 14.5 8s-2.8 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2.2" />
    </Svg16>
  );
}

/** Codicon-like: discard / undo */
export function IconUndo(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M4.5 7.5H11a3 3 0 0 1 0 6H9.5" />
      <path d="M4.5 7.5 7 5" />
      <path d="M4.5 7.5 7 10" />
    </Svg16>
  );
}

/** Codicon-like: wrench / fix */
export function IconWrench(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M10.2 2.8a3.2 3.2 0 0 0-4.3 4.3L2.5 10.5v3h3l3.4-3.4a3.2 3.2 0 0 0 4.3-4.3L11 7.5 10.2 2.8z" />
    </Svg16>
  );
}

/** Codicon-like: close */
export function IconClose(props: IconProps) {
  return (
    <Svg16 {...props} size={props.size ?? 12}>
      <path d="M4 4l8 8" />
      <path d="M12 4 4 12" />
    </Svg16>
  );
}

/** Codicon-like: diff */
export function IconDiff(props: IconProps) {
  return (
    <Svg16 {...props}>
      <path d="M3.5 2.5h5.2L12.5 6.3V13.5H3.5z" />
      <path d="M8.5 2.5v4h4" />
      <path d="M6 9h4" />
      <path d="M8 7v4" />
    </Svg16>
  );
}
