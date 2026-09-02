import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const defaults: IconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.35,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
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

/** Classic settings gear — outline, hollow hub. */
export function IconSettings(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M8.75 1.6h-1.5l-.22 1.55a4.7 4.7 0 0 0-1.12.46L4.7 2.95 3.45 4.2l.66 1.21a4.7 4.7 0 0 0-.46 1.12L2.1 6.75v1.5l1.55.22c.1.4.25.78.46 1.12l-.66 1.21 1.25 1.25 1.21-.66c.34.21.72.36 1.12.46l.22 1.55h1.5l.22-1.55c.4-.1.78-.25 1.12-.46l1.21.66 1.25-1.25-.66-1.21c.21-.34.36-.72.46-1.12l1.55-.22v-1.5l-1.55-.22a4.7 4.7 0 0 0-.46-1.12l.66-1.21L11.3 2.95l-1.21.66a4.7 4.7 0 0 0-1.12-.46L8.75 1.6z" />
      <circle cx="8" cy="8" r="2.05" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4.25 6.25 8 10l3.75-3.75" />
    </svg>
  );
}

/** Token / usage meter glyph (distinct from Settings gear). */
export function IconTokens(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 4.5h9v2.5H3.5z" />
      <path d="M3.5 9h9v2.5H3.5z" />
      <path d="M5.5 4.5v7.5M10.5 4.5v7.5" />
    </svg>
  );
}

export function IconModel(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <rect x="3" y="4" width="10" height="8" rx="1.5" />
      <path d="M5.5 6.5h5M5.5 9.5h3" />
      <path d="M6 2.5v1.5M10 2.5v1.5M6 12v1.5M10 12v1.5" />
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

export function IconTrash(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 4.5h9" />
      <path d="M6.5 4.5v-1h3v1" />
      <path d="M5 6.5v6a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6" />
      <path d="M7 7.5v4M9 7.5v4" />
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

export function IconSlash(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M10.8 3.2 5.2 12.8" />
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

/** Workspace index / folder status glyph (color via CSS currentColor). */
export function IconFolder(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M2.25 4.75h3.1l1.15 1.2H13.75v6.3a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1V4.75z" />
      <path d="M2.25 4.75V3.9A.9.9 0 0 1 3.15 3h2.55" />
    </svg>
  );
}

export function IconPlug(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M6 2.5v3M10 2.5v3" />
      <path d="M4.5 5.5h7v3.2A3.5 3.5 0 0 1 8 12.2 3.5 3.5 0 0 1 4.5 8.7z" />
      <path d="M8 12.2V14" />
    </svg>
  );
}

export function IconBug(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8.5" r="3.2" />
      <path d="M8 3.2v1.6M4.2 5.2 5.4 6.2M11.8 5.2 10.6 6.2M3.2 8.5h1.6M11.2 8.5h1.6M4.2 12 5.4 11M11.8 12 10.6 11" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M8 2.8 13.2 5.6 8 8.4 2.8 5.6 8 2.8z" />
      <path d="M3.2 8.2 8 10.8l4.8-2.6" />
      <path d="M3.2 11 8 13.6l4.8-2.6" />
    </svg>
  );
}

export function IconHelpCircle(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.4 6.2a1.8 1.8 0 0 1 3.5.6c0 1.4-1.9 1.5-1.9 3" />
      <path d="M8 12h.01" />
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
      <rect
        x="4.5"
        y="4.5"
        width="7"
        height="7"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
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

export function IconAskApproval(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5.2 7.8V5.4a1 1 0 0 1 2 0v2" />
      <path d="M7.2 7.6V4.6a1 1 0 0 1 2 0v3" />
      <path d="M9.2 7.5V5.2a1 1 0 0 1 2 0v3.4" />
      <path d="M5.2 7.8c-1 .4-1.7 1.3-1.7 2.4 0 1.6 1.5 2.8 3.5 2.8h2.6c1.6 0 2.9-1.1 2.9-2.6V8.6" />
    </svg>
  );
}

export function IconApproveForMe(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="6.2" r="1.6" />
      <path d="M4.8 12c.7-1.5 1.9-2.2 3.2-2.2s2.5.7 3.2 2.2" />
    </svg>
  );
}

export function IconFullAccess(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.8v4.2" />
      <path d="M8 11.3h.01" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 8.2 6.5 11l6-6.5" />
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

export function IconEffortLow(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 11.5v-2h2v2z" />
      <path d="M7 11.5v-4h2v4z" opacity="0.35" />
      <path d="M10.5 11.5v-7h2v7z" opacity="0.35" />
    </svg>
  );
}

export function IconEffortMedium(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 11.5v-2h2v2z" />
      <path d="M7 11.5v-4h2v4z" />
      <path d="M10.5 11.5v-7h2v7z" opacity="0.35" />
    </svg>
  );
}

export function IconEffortHigh(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3.5 11.5v-2h2v2z" />
      <path d="M7 11.5v-4h2v4z" />
      <path d="M10.5 11.5v-7h2v7z" />
    </svg>
  );
}
