import { COMPOSER_MODE_COLORS } from '@mitii/ui-react';

import type { AgentUiMode } from './protocol';

/** Mode accent colors — shared by composer controls, send button, and pins. `review` is webview-only. */
export const MODE_COLORS: Record<AgentUiMode, string> = {
  ...COMPOSER_MODE_COLORS,
  review: '#38bdf8',
};

export function modeColor(mode: AgentUiMode): string {
  return MODE_COLORS[mode] ?? MODE_COLORS.ask;
}
