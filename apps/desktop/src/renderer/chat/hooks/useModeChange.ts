/** Agent mode switching (incl. Database access readiness). */

import { type DesktopAgentMode } from '../../../shared/protocol.js';
import type { ComposerApprovalMode, ComposerThoroughness } from '@mitii/ui-react';
import type { useComposerState } from './useComposerState.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useSettingsActions } from '../../settings/hooks/useSettingsActions.js';
import type { useEngineLifecycle } from '../../shell/hooks/useEngineLifecycle.js';

export function useModeChange(deps: Pick<
    ReturnType<typeof useComposerState>,
    'setMode' | 'setThoroughness' | 'setApprovalMode' | 'dbAccess'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'settings' | 'setError'
  > &
  Pick<
    ReturnType<typeof useSettingsActions>,
    'onSelectModel'
  > &
  Pick<
    ReturnType<typeof useEngineLifecycle>,
    'engineRestartChainRef' | 'ensureDatabaseAccessReady'
  >) {
  const {
    setMode,
    setThoroughness,
    setApprovalMode,
    dbAccess,
    settings,
    setError,
    onSelectModel,
    engineRestartChainRef,
    ensureDatabaseAccessReady,
  } = deps;

  const onModeChange = (next: DesktopAgentMode) => {
    setMode(next);
    if (next === 'ask' || next === 'plan' || next === 'agent') {
      const defaults = settings.ui.modeDefaults[next];
      if (defaults) {
        const rawThorough = String(defaults.thoroughness ?? 'medium');
        const nextThorough: ComposerThoroughness =
          rawThorough === 'low' || rawThorough === 'quick'
            ? 'low'
            : rawThorough === 'high' || rawThorough === 'thorough'
              ? 'high'
              : 'medium';
        setThoroughness(nextThorough);

        const rawApproval = String(defaults.approvalMode ?? 'guided');
        const nextApproval: ComposerApprovalMode =
          rawApproval === 'safe' ||
          rawApproval === 'guided' ||
          rawApproval === 'pilot'
            ? rawApproval
            : 'guided';
        setApprovalMode(nextApproval);

        const nextModel = defaults.model?.trim();
        if (nextModel) {
          // Queue on the restart chain so an immediate Send cannot race the
          // model-switch engine reboot (Failed to fetch / unreachable banner).
          const pending = onSelectModel(nextModel);
          engineRestartChainRef.current = engineRestartChainRef.current
            .then(() => pending)
            .then(
              () => undefined,
              () => undefined,
            );
        }
      }
    }

    // Stamp MCP_DB_ACCESS when entering Database mode so Read & write is not
    // stuck on a stale readonly MCP process from install.
    if (next === 'database') {
      void ensureDatabaseAccessReady(dbAccess).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    }
  };

  return {
    onModeChange,
  };
}
