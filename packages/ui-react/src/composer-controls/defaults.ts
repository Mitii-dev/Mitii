import type {
  ComposerApprovalMode,
  ComposerDbAccess,
  ComposerMode,
  ComposerOption,
  ComposerThoroughness,
} from './types.js';

export const COMPOSER_MODE_COLORS: Readonly<Record<ComposerMode, string>> = {
  ask: '#22c55e',
  plan: '#f59e0b',
  agent: '#ef4444',
  database: '#06b6d4',
};

/** Accent colour for a mode id; unknown ids fall back to the Ask colour. */
export function composerModeColor(mode: string): string {
  return COMPOSER_MODE_COLORS[mode as ComposerMode] ?? COMPOSER_MODE_COLORS.ask;
}

export const DEFAULT_MODE_OPTIONS: readonly ComposerOption<ComposerMode>[] = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Explore and answer — read-only',
    color: COMPOSER_MODE_COLORS.ask,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Analyze and propose a structured plan',
    color: COMPOSER_MODE_COLORS.plan,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Implement changes with controlled execution',
    color: COMPOSER_MODE_COLORS.agent,
  },
  {
    id: 'database',
    label: 'Database',
    description: 'Query connected DBs via MCP',
    color: COMPOSER_MODE_COLORS.database,
  },
];

export const DEFAULT_APPROVAL_OPTIONS: readonly ComposerOption<ComposerApprovalMode>[] = [
  {
    id: 'safe',
    label: 'Ask for approval',
    description: 'Pause before mutations and plan execution',
    color: '#38bdf8',
  },
  {
    id: 'guided',
    label: 'Approve for me',
    description: 'Auto-approve routine mutations; pause on risk',
    color: '#22c55e',
  },
  {
    id: 'pilot',
    label: 'Full access',
    description: 'Unrestricted access to tools, network, and workspace files',
    color: '#c9b27a',
    warning: true,
  },
];

export const DEFAULT_THOROUGHNESS_OPTIONS: readonly ComposerOption<ComposerThoroughness>[] = [
  {
    id: 'low',
    label: 'Low',
    description: 'Quick look, lighter context, fewer loop/repair calls',
    color: '#94a3b8',
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Balanced depth and working set for most tasks',
    color: '#38bdf8',
  },
  {
    id: 'high',
    label: 'High',
    description: 'Deep exploration, broader retrieval, more repairs',
    color: '#f59e0b',
  },
];

export const DEFAULT_DB_ACCESS_OPTIONS: readonly ComposerOption<ComposerDbAccess>[] = [
  {
    id: 'readonly',
    label: 'Read-only',
    description: 'Schema discovery and SELECT / find / aggregate only',
    color: '#38bdf8',
  },
  {
    id: 'readwrite',
    label: 'Read & write',
    description: 'Allow INSERT / UPDATE / DELETE via MCP (approval on writes)',
    color: '#f59e0b',
    warning: true,
  },
];

/** Thoroughness trigger shown while `intensityCustom` is on. */
export const CUSTOM_THOROUGHNESS_OPTION: ComposerOption<'custom'> = {
  id: 'custom',
  label: 'Custom',
  description: 'Developer intensity overrides are on — pick a level to reset',
  color: '#a78bfa',
};
