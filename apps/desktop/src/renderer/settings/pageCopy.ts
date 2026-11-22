/** Per-tab page titles and descriptions. */

import { type SettingsTabId } from '../../shared/settings.js';

export const PAGE_COPY: Record<SettingsTabId, { title: string; description: string }> =
  {
    storage: {
      title: 'Storage',
      description:
        'Root storage for all projects. Each project lives under projects/<name>--<id>/.',
    },
    workspaces: {
      title: 'Workspaces',
      description: 'Connected repositories and per-workspace index settings.',
    },
    profiles: {
      title: 'Profiles',
      description:
        'Provider, modes, and run budget. Open a tile to edit, or create a new profile.',
    },
    context: {
      title: 'Context',
      description: 'What Mitii attaches to each turn.',
    },
    features: {
      title: 'Features',
      description:
        'Autocomplete, code review, commit messages, web search, and semantic index.',
    },
    debug: {
      title: 'Developer',
      description:
        'Diagnostics and advanced controls. Applies to all profiles.',
    },
  };
