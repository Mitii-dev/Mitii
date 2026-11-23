/**
 * Terminal styling for Mitii CLI. Brand orange matches `--mitii-brand` (#ff751f).
 * Honors NO_COLOR / FORCE_COLOR and non-TTY sinks.
 */

export const MITII_BRAND_HEX = '#ff751f';
export const MITII_BRAND_RGB = { r: 255, g: 117, b: 31 } as const;

const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const FG_BRAND = `\u001b[38;2;${MITII_BRAND_RGB.r};${MITII_BRAND_RGB.g};${MITII_BRAND_RGB.b}m`;
const FG_MUTED = '\u001b[38;2;160;160;160m';
const FG_OK = '\u001b[38;2;34;197;94m';
const FG_WARN = '\u001b[38;2;251;191;36m';
const FG_DANGER = '\u001b[38;2;249;112;102m';
const FG_TEXT = '\u001b[38;2;228;230;231m';

export type TermColorMode = 'auto' | 'always' | 'never';

let forcedMode: TermColorMode = 'auto';

export function setTermColorMode(mode: TermColorMode): void {
  forcedMode = mode;
}

export function termColorEnabled(
  stream: { isTTY?: boolean } = process.stderr,
): boolean {
  if (forcedMode === 'always') return true;
  if (forcedMode === 'never') return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') {
    return false;
  }
  if (process.env.FORCE_COLOR === '0') return false;
  if (
    process.env.FORCE_COLOR !== undefined &&
    process.env.FORCE_COLOR !== '' &&
    process.env.FORCE_COLOR !== '0'
  ) {
    return true;
  }
  return stream.isTTY === true;
}

function paint(
  open: string,
  text: string,
  enabled: boolean,
): string {
  if (!enabled || !text) return text;
  return `${open}${text}${RESET}`;
}

export interface TermStyle {
  enabled: boolean;
  brand: (text: string) => string;
  bold: (text: string) => string;
  dim: (text: string) => string;
  muted: (text: string) => string;
  ok: (text: string) => string;
  warn: (text: string) => string;
  danger: (text: string) => string;
  text: (text: string) => string;
  label: (text: string) => string;
  rule: (width?: number) => string;
}

export function createTermStyle(
  stream: { isTTY?: boolean } = process.stderr,
): TermStyle {
  const enabled = termColorEnabled(stream);
  return {
    enabled,
    brand: (t) => paint(FG_BRAND + BOLD, t, enabled),
    bold: (t) => paint(BOLD, t, enabled),
    dim: (t) => paint(DIM, t, enabled),
    muted: (t) => paint(FG_MUTED, t, enabled),
    ok: (t) => paint(FG_OK, t, enabled),
    warn: (t) => paint(FG_WARN, t, enabled),
    danger: (t) => paint(FG_DANGER, t, enabled),
    text: (t) => paint(FG_TEXT, t, enabled),
    label: (t) => paint(FG_BRAND, t.padEnd(12), enabled),
    rule: (width = 56) =>
      paint(FG_BRAND + DIM, '─'.repeat(Math.max(8, width)), enabled),
  };
}

/** Prompt prefix for the interactive session. */
export function formatSessionPrompt(style?: TermStyle): string {
  const s = style ?? createTermStyle(process.stdout);
  return `${s.brand('mitii')}${s.muted(' › ')}`;
}
