/** Index status polling, pause, reindex and save-triggered refresh. */

import { useCallback, useEffect } from 'react';
import { fetchIndexStatus, pauseIndexing, reindexWorkspace } from '../../api.js';
import type { useIndexState } from './useIndexState.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';

export function useIndexStatus(deps: Pick<
    ReturnType<typeof useIndexState>,
    'setIndexStream' | 'setIndexStatus' | 'setIndexIndexing' | 'setIndexEmbeddingBg'
    | 'setIndexProgress' | 'reindexInFlightRef' | 'indexSaveTimerRef' | 'indexIndexing'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'engine' | 'setError' | 'snapshot' | 'settings'
  >) {
  const {
    setIndexStream,
    setIndexStatus,
    setIndexIndexing,
    setIndexEmbeddingBg,
    setIndexProgress,
    reindexInFlightRef,
    indexSaveTimerRef,
    indexIndexing,
    engine,
    setError,
    snapshot,
    settings,
  } = deps;

  const pushIndexStream = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setIndexStream((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.endsWith(line)) return prev;
      return [...prev.slice(-80), `${stamp}  ${line}`];
    });
  }, []);

  const applyIndexStatus = useCallback(
    (
      s: Awaited<ReturnType<typeof fetchIndexStatus>>,
      opts?: { clearIfIdle?: boolean },
    ) => {
      setIndexStatus({
        indexed: s.indexed,
        fileCount: s.fileCount,
        truncated: s.truncated,
        lastIndexedAt: s.lastIndexedAt,
        message: s.message,
        embeddingError: s.embeddingError,
        running: s.running,
        lexicalReady: s.lexicalReady,
        embeddingPhase: s.embeddingPhase,
        ...(s.health ? { health: s.health } : {}),
      });
      if (s.running) {
        setIndexIndexing(true);
        const embeddingBg =
          s.progressStage === 'embedding' ||
          s.progressStage === 'lexical_ready' ||
          s.embeddingPhase === 'running' ||
          s.embeddingPhase === 'pending' ||
          Boolean(s.lexicalReady);
        setIndexEmbeddingBg(embeddingBg);
        if (typeof s.progressPercent === 'number') {
          setIndexProgress(s.progressPercent);
        }
        if (s.progressMessage) pushIndexStream(s.progressMessage);
        return;
      }
      if (opts?.clearIfIdle !== false && !reindexInFlightRef.current) {
        setIndexIndexing(false);
        setIndexEmbeddingBg(false);
        setIndexProgress(null);
      }
    },
    [pushIndexStream],
  );

  const refreshIndexStatus = useCallback(async () => {
    if (!engine) return;
    try {
      const s = await fetchIndexStatus(engine);
      applyIndexStatus(s);
      return s;
    } catch {
      /* non-fatal */
      return null;
    }
  }, [engine, applyIndexStatus]);

  const pauseIndex = useCallback(async () => {
    if (!engine) return;
    try {
      const result = await pauseIndexing(engine);
      pushIndexStream(result.message);
      if (!result.paused) {
        await refreshIndexStatus();
        return;
      }
      // Don't flip UI to idle immediately — abort waits for the current file.
      // Poll until the lock clears so Pause doesn't look like a no-op.
      pushIndexStream('Stopping…');
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => window.setTimeout(r, 400));
        const s = await fetchIndexStatus(engine);
        if (!s.running) {
          reindexInFlightRef.current = false;
          setIndexIndexing(false);
          setIndexEmbeddingBg(false);
          setIndexProgress(null);
          applyIndexStatus(s);
          pushIndexStream('Index paused — FTS/symbols kept; embeddings may be partial.');
          return;
        }
        applyIndexStatus(s, { clearIfIdle: false });
        if (typeof s.progressPercent === 'number') {
          setIndexProgress(s.progressPercent);
        }
      }
      pushIndexStream(
        'Still stopping — wait for the current file batch to finish.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [engine, pushIndexStream, refreshIndexStatus, applyIndexStatus]);

  const onFileSavedDebounced = useCallback(
    (_path: string) => {
      if (indexSaveTimerRef.current != null) {
        window.clearTimeout(indexSaveTimerRef.current);
      }
      indexSaveTimerRef.current = window.setTimeout(() => {
        indexSaveTimerRef.current = null;
        void refreshIndexStatus();
      }, 750);
    },
    [refreshIndexStatus],
  );

  const runReindex = useCallback(async (opts?: { force?: boolean }) => {
    if (!engine || !snapshot) return;
    const force = opts?.force === true;
    reindexInFlightRef.current = true;
    setIndexIndexing(true);
    setIndexEmbeddingBg(false);
    setIndexProgress(2);
    setIndexStream([]);
    pushIndexStream(force ? 'Full rebuild started…' : 'Index refresh started…');
    try {
      const result = await reindexWorkspace({
        ...engine,
        force,
        maximumFiles: settings.workspace.maximumIndexFiles || undefined,
        semanticIndex: {
          enabled: settings.semanticIndex.enabled,
          source: settings.semanticIndex.source,
          model: settings.semanticIndex.model,
          dimensions: settings.semanticIndex.dimensions,
          normalized: settings.semanticIndex.normalized,
          baseUrl: settings.provider.baseUrl,
        },
        onProgress: (event) => {
          if (typeof event.percent === 'number') {
            setIndexProgress(Math.max(0, Math.min(99, event.percent)));
          }
          const embeddingBg =
            event.stage === 'embedding' ||
            event.stage === 'lexical_ready' ||
            event.embeddingPhase === 'running' ||
            event.embeddingPhase === 'pending' ||
            Boolean(event.lexicalReady);
          setIndexEmbeddingBg(embeddingBg);
          if (event.message) {
            const detail =
              typeof event.fileCount === 'number' && event.fileCount > 0
                ? `${event.message} (${event.fileCount.toLocaleString()} files)`
                : event.message;
            pushIndexStream(detail);
          }
        },
      });
      if (result.status === 'skipped') {
        pushIndexStream(result.message || 'Indexing already running…');
        // Attach to the other process via status polling (lock held).
        await refreshIndexStatus();
        return;
      }
      setIndexProgress(100);
      pushIndexStream(result.message || (force ? 'Rebuild finished' : 'Refresh finished'));
      if (result.fileCount > 0) {
        pushIndexStream(
          `${result.fileCount.toLocaleString()} files in index`,
        );
      }
      if (result.statusSnapshot) {
        applyIndexStatus(result.statusSnapshot);
      } else {
        await refreshIndexStatus();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Legacy 500 lock errors — treat as "already running".
      if (/already running|index\.lock/i.test(msg)) {
        pushIndexStream(
          'Indexing already running — watching progress in the header…',
        );
        await refreshIndexStatus();
        return;
      }
      setError(msg);
      pushIndexStream(`Error: ${msg}`);
      setIndexIndexing(false);
      setIndexEmbeddingBg(false);
      setIndexProgress(null);
    } finally {
      reindexInFlightRef.current = false;
    }
  }, [
    engine,
    snapshot,
    settings,
    refreshIndexStatus,
    pushIndexStream,
    applyIndexStatus,
  ]);

  // Keep header spinner honest while lock is held (local or another process).
  useEffect(() => {
    if (!engine || !indexIndexing) return;
    const poll = window.setInterval(() => {
      void fetchIndexStatus(engine)
        .then((s) => applyIndexStatus(s, { clearIfIdle: !reindexInFlightRef.current }))
        .catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(poll);
  }, [engine, indexIndexing, applyIndexStatus]);

  return {
    runReindex,
    pauseIndex,
    onFileSavedDebounced,
    pushIndexStream,
    refreshIndexStatus,
  };
}
