/** Desktop wiring for the incremental workspace semantic index. */

import {
  resolveIndexConcurrency,
  type SemanticIndexSettings,
} from '@mitii/host';

import { readDesktopSettingsJson } from '../startOptions.js';
import {
  startIncrementalWorkspaceIndex,
  type IncrementalIndexController,
} from './incrementalIndex.js';
import type { WorkspaceWatcher } from './workspaceWatch.js';

export function resolveDesktopSemanticIndex(): SemanticIndexSettings | undefined {
  const normalizeSource = (
    raw: string | undefined,
  ): SemanticIndexSettings['source'] => {
    if (raw === 'ollama' || raw === 'bundled' || raw === 'disabled') return raw;
    if (raw === 'openai-compatible' || raw === 'openai_compatible') {
      return 'openai-compatible';
    }
    return 'bundled';
  };
  try {
    const settings = readDesktopSettingsJson();
    const semantic = settings?.semanticIndex as
      | {
          enabled?: boolean;
          source?: string;
          model?: string;
          dimensions?: number;
          normalized?: boolean;
        }
      | undefined;
    const provider = settings?.provider as { baseUrl?: string } | undefined;
    return {
      enabled: semantic?.enabled === true,
      source: normalizeSource(semantic?.source),
      model: semantic?.model ?? '',
      dimensions: semantic?.dimensions ?? 0,
      normalized: semantic?.normalized !== false,
      baseUrl: provider?.baseUrl ?? process.env.MITII_BASE_URL ?? '',
      apiKey: process.env.MITII_API_KEY,
    };
  } catch {
    return {
      enabled: false,
      source: 'bundled',
      model: '',
      dimensions: 0,
      normalized: true,
      baseUrl: '',
    };
  }
}

/** Leave headroom on the shared engine thread for explorer HTTP. */
export function resolveDesktopIndexConcurrency(): number {
  return Math.min(4, resolveIndexConcurrency());
}

export function startDesktopIncrementalIndex(
  workspaceRoot: string,
  watcher: WorkspaceWatcher,
): IncrementalIndexController {
  return startIncrementalWorkspaceIndex({
    workspaceRoot,
    watcher,
    resolveSemanticIndex: resolveDesktopSemanticIndex,
    resolveConcurrency: resolveDesktopIndexConcurrency,
  });
}
