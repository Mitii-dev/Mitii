/** Snapshot refresh, serialized engine restarts and readiness gates. */

import { useCallback, useRef } from 'react';
import { getDesktopBridge, setDatabaseMcpAccess, fetchMcpServers } from '../../api.js';
import { type DesktopShellSnapshot } from '../../../shared/bridge.js';
import { type DatabaseAccessUiMode } from '../../chat/ComposerControls.js';
import type { useEngineSnapshot } from './useEngineSnapshot.js';
import type { useProviderState } from '../../settings/hooks/useProviderState.js';

export function useEngineLifecycle(deps: Pick<
    ReturnType<typeof useEngineSnapshot>,
    'setError' | 'setSnapshot'
  > &
  Pick<
    ReturnType<typeof useProviderState>,
    'setMcpMasterEnabled' | 'setMcpServers'
  >) {
  const {
    setError,
    setSnapshot,
    setMcpMasterEnabled,
    setMcpServers,
  } = deps;

  const refresh = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge missing. Rebuild and relaunch.');
      return;
    }
    setSnapshot(await bridge.getSnapshot());
    setError(null);
  }, []);

  /**
   * Serialize engine restarts (Read & write / MCP install). First Database
   * message used to race a still-dying engine URL → Failed to fetch; retry
   * worked because the new engine was up. Chain + health wait fixes that.
   */
  const engineRestartChainRef = useRef(Promise.resolve());

  const waitForEngineHealth = useCallback(
    async (snap: DesktopShellSnapshot, timeoutMs = 20_000): Promise<boolean> => {
      const healthUrl = `${snap.engineBaseUrl.replace(/\/$/, '')}/health`;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(healthUrl, {
            headers: snap.authToken
              ? { authorization: `Bearer ${snap.authToken}` }
              : undefined,
          });
          if (res.ok) return true;
        } catch {
          /* engine still booting */
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      return false;
    },
    [],
  );

  const restartEngineAndRefresh = useCallback(async (): Promise<DesktopShellSnapshot> => {
    const run = async (): Promise<DesktopShellSnapshot> => {
      const bridge = getDesktopBridge();
      if (!bridge?.restartEngine) {
        throw new Error('Engine restart unavailable');
      }
      const result = await bridge.restartEngine();
      if (result && result.ok === false) {
        throw new Error(result.reason || 'Engine restart failed');
      }
      const nextSnap = await bridge.getSnapshot();
      setSnapshot(nextSnap);
      await waitForEngineHealth(nextSnap, 20_000);
      return nextSnap;
    };
    const queued = engineRestartChainRef.current.then(run, run);
    engineRestartChainRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, [waitForEngineHealth]);

  /**
   * Always refresh the live engine URL before a prompt. Mode/model switches
   * restart the engine; chatting against a stale port surfaces as
   * "Engine briefly unreachable".
   */
  const ensureEngineReadyForPrompt = useCallback(async (): Promise<{
    engine: { baseUrl: string; token: string };
    snapshot: DesktopShellSnapshot;
  }> => {
    await engineRestartChainRef.current;
    const bridge = getDesktopBridge();
    if (!bridge) {
      throw new Error('Desktop bridge missing. Rebuild and relaunch.');
    }
    let nextSnap = await bridge.getSnapshot();
    setSnapshot(nextSnap);
    if (!(await waitForEngineHealth(nextSnap, 8_000))) {
      nextSnap = await restartEngineAndRefresh();
    }
    return {
      engine: {
        baseUrl: nextSnap.engineBaseUrl,
        token: nextSnap.authToken,
      },
      snapshot: nextSnap,
    };
  }, [restartEngineAndRefresh, waitForEngineHealth]);

  const ensureDatabaseAccessReady = useCallback(
    async (
      access: DatabaseAccessUiMode,
    ): Promise<{
      engine: { baseUrl: string; token: string };
      snapshot: DesktopShellSnapshot;
    }> => {
      // Finish any restart already kicked off by the access dropdown.
      await engineRestartChainRef.current;

      const bridge = getDesktopBridge();
      if (!bridge) {
        throw new Error('Desktop bridge missing. Rebuild and relaunch.');
      }
      let snap = await bridge.getSnapshot();
      setSnapshot(snap);
      const eng = {
        baseUrl: snap.engineBaseUrl,
        token: snap.authToken ?? '',
      };
      const accessResult = await setDatabaseMcpAccess({
        ...eng,
        dbAccess: access,
      });
      await fetchMcpServers(eng)
        .then((payload) => {
          setMcpMasterEnabled(Boolean(payload.enabled));
          setMcpServers(payload.servers ?? []);
        })
        .catch(() => undefined);

      if (accessResult.restartRequired) {
        snap = await restartEngineAndRefresh();
      }

      return {
        engine: {
          baseUrl: snap.engineBaseUrl,
          token: snap.authToken ?? '',
        },
        snapshot: snap,
      };
    },
    [restartEngineAndRefresh],
  );

  return {
    refresh,
    waitForEngineHealth,
    engineRestartChainRef,
    ensureDatabaseAccessReady,
    ensureEngineReadyForPrompt,
  };
}
