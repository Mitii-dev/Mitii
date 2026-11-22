/** Keep Database-mode MCP status in sync while the MCP panel is open. */

import { useEffect } from 'react';
import { fetchMcpServers } from '../../api.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useComposerState } from './useComposerState.js';
import type { useProviderState } from '../../settings/hooks/useProviderState.js';
import type { useShellUiState } from '../../shell/hooks/useShellUiState.js';

export function useDatabaseMcpSync(deps: Pick<
    ReturnType<typeof useEngineSnapshot>,
    'engine' | 'snapshot'
  > &
  Pick<
    ReturnType<typeof useComposerState>,
    'mode'
  > &
  Pick<
    ReturnType<typeof useProviderState>,
    'setMcpMasterEnabled' | 'setMcpServers' | 'setMcpStatusReady'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'workspaceSide'
  >) {
  const {
    engine,
    snapshot,
    mode,
    setMcpMasterEnabled,
    setMcpServers,
    setMcpStatusReady,
    workspaceSide,
  } = deps;

  // Keep Database mode banner in sync with MCP installs (especially while MCP panel is open).
  useEffect(() => {
    if (!engine || mode !== 'database') return;
    let cancelled = false;
    const refresh = () => {
      void fetchMcpServers(engine)
        .then((payload) => {
          if (cancelled) return;
          setMcpMasterEnabled(Boolean(payload.enabled));
          setMcpServers(payload.servers ?? []);
          setMcpStatusReady(true);
        })
        .catch(() => undefined);
    };
    refresh();
    const handle =
      workspaceSide === 'mcp'
        ? window.setInterval(refresh, 2_500)
        : undefined;
    return () => {
      cancelled = true;
      if (handle !== undefined) window.clearInterval(handle);
    };
  }, [
    mode,
    workspaceSide,
    snapshot?.workspaceRoot,
    snapshot?.engineBaseUrl,
  ]);
}
