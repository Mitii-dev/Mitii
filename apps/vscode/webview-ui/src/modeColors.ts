import type { AgentUiMode } from './protocol';

/** Mode accent colors — shared by composer controls, send button, and pins. */
export const MODE_COLORS: Record<AgentUiMode, string> = {
  ask: '#22c55e',
  plan: '#f59e0b',
  agent: '#ef4444',
  review: '#38bdf8',
};

export function modeColor(mode: AgentUiMode): string {
  return MODE_COLORS[mode] ?? MODE_COLORS.ask;
}
