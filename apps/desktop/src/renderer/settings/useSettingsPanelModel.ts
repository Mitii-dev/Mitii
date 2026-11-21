/** State, effects and actions for the settings panel. */

import { useState, useEffect } from 'react';
import {
  type SettingsTabId,
  type DesktopSettings,
  mergeDesktopSettings,
} from '../../shared/settings.js';
import {
  type MemoryItemView,
  type CheckpointItemView,
  getDesktopBridge,
  fetchIndexStatus,
  fetchMemories,
  fetchCheckpoints,
  fetchProviderModels,
  pullOllamaEmbeddingModel,
} from '../api.js';
import { type DesktopStorageInfo } from '../../shared/bridge.js';
import {
  type NomicInstallStatus,
  resolveOllamaEmbeddingBaseUrl,
  isNomicEmbedInstalled,
  NOMIC_EMBED_MODEL,
} from './nomicEmbed.js';
import { type FeatureTabId, type SettingsPanelProps } from './types.js';
import { PAGE_COPY } from './pageCopy.js';

export function useSettingsPanelModel(props: SettingsPanelProps) {
  const [internalTab, setInternalTab] = useState<SettingsTabId>('profiles');

  const tab = props.tab ?? internalTab;

  const setTab = (next: SettingsTabId) => {
    if (props.onTabChange) props.onTabChange(next);
    else setInternalTab(next);
  };

  const [draft, setDraft] = useState<DesktopSettings>(() =>
    mergeDesktopSettings(props.settings),
  );

  const [apiKey, setApiKey] = useState('');

  const [clearApiKey, setClearApiKey] = useState(false);

  const [searchApiKey, setSearchApiKey] = useState('');

  const [clearSearchApiKey, setClearSearchApiKey] = useState(false);

  const [saving, setSaving] = useState(false);

  const [note, setNote] = useState<string | null>(null);

  const [indexMessage, setIndexMessage] = useState('…');

  const [reindexing, setReindexing] = useState(false);

  const [nomicStatus, setNomicStatus] = useState<NomicInstallStatus>('checking');

  const [nomicProgress, setNomicProgress] = useState<number | undefined>();

  const [nomicNote, setNomicNote] = useState<string | null>(null);

  const [memories, setMemories] = useState<MemoryItemView[]>([]);

  const [checkpoints, setCheckpoints] = useState<CheckpointItemView[]>([]);

  const [contextBusy, setContextBusy] = useState(false);

  const [contextNote, setContextNote] = useState<string | null>(null);

  const [storage, setStorage] = useState<DesktopStorageInfo | null>(null);

  const [storageBusy, setStorageBusy] = useState(false);

  const [storageNote, setStorageNote] = useState<string | null>(null);

  const [internalFeatureTab, setInternalFeatureTab] =
    useState<FeatureTabId>('autocomplete');

  const featureTab = props.featureTab ?? internalFeatureTab;

  const setFeatureTab = (next: FeatureTabId) => {
    if (props.onFeatureTabChange) props.onFeatureTabChange(next);
    else setInternalFeatureTab(next);
  };

  const featureTabs = [
    { id: 'autocomplete' as const, label: 'Inline completion' },
    { id: 'review' as const, label: 'Working-tree review' },
    { id: 'agent' as const, label: 'Commit & agent' },
    { id: 'search' as const, label: 'Web search' },
    { id: 'index' as const, label: 'Semantic index' },
  ];

  // Autocomplete is locked until desktop FIM lands — keep settings visible but inert.

  const refreshStorage = async () => {
    const bridge = getDesktopBridge();
    if (!bridge?.getStorageInfo) return;
    try {
      setStorage(await bridge.getStorageInfo());
    } catch (err) {
      setStorageNote(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refreshStorage();
  }, [props.workspaceRoot]);

  useEffect(() => {
    const next = mergeDesktopSettings(props.settings);
    setDraft(next);
  }, [props.settings]);

  useEffect(() => {
    if (!props.engineBaseUrl) return;
    const opts = {
      baseUrl: props.engineBaseUrl,
      token: props.authToken,
    };
    void fetchIndexStatus(opts)
      .then((status) => setIndexMessage(status.message))
      .catch(() => setIndexMessage('Index unavailable'));
  }, [props.engineBaseUrl, props.authToken, props.workspaceRoot]);

  useEffect(() => {
    if (tab !== 'context' || !props.engineBaseUrl) return;
    const opts = {
      baseUrl: props.engineBaseUrl,
      token: props.authToken,
    };
    void Promise.all([fetchMemories(opts), fetchCheckpoints(opts)])
      .then(([nextMemories, nextCheckpoints]) => {
        setMemories(nextMemories);
        setCheckpoints(nextCheckpoints);
        setContextNote(null);
      })
      .catch((err: unknown) => {
        setContextNote(err instanceof Error ? err.message : String(err));
      });
  }, [tab, props.engineBaseUrl, props.authToken, props.workspaceRoot]);

  const patch = (partial: unknown) => {
    setDraft((prev) => mergeDesktopSettings(partial, prev));
  };

  const ollamaEmbeddingBaseUrl = resolveOllamaEmbeddingBaseUrl(
    draft.provider.baseUrl,
  );

  const refreshNomicStatus = async () => {
    if (!props.engineBaseUrl || nomicStatus === 'downloading') return;
    setNomicStatus('checking');
    try {
      const models = await fetchProviderModels({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        type: 'openai-compatible',
        providerBaseUrl: ollamaEmbeddingBaseUrl,
      });
      if (isNomicEmbedInstalled(models)) {
        setNomicStatus('ready');
        setNomicNote(null);
        return;
      }
      // Empty catalog usually means Ollama is down; still offer download.
      setNomicStatus(models.length === 0 ? 'unreachable' : 'missing');
      setNomicNote(
        models.length === 0
          ? 'Ollama is not reachable. Install and start Ollama to download Nomic.'
          : null,
      );
    } catch {
      setNomicStatus('unreachable');
      setNomicNote(
        'Ollama is not reachable. Install and start Ollama to download Nomic.',
      );
    }
  };

  useEffect(() => {
    if (!draft.semanticIndex.enabled || !props.engineBaseUrl) return;
    if (featureTab !== 'index') return;
    void refreshNomicStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when index tab / engine / ollama URL change
  }, [
    draft.semanticIndex.enabled,
    featureTab,
    props.engineBaseUrl,
    props.authToken,
    ollamaEmbeddingBaseUrl,
  ]);

  const downloadNomic = async () => {
    if (!props.engineBaseUrl || nomicStatus === 'downloading') return;
    setNomicStatus('downloading');
    setNomicProgress(undefined);
    setNomicNote('Downloading Nomic Embed Text via Ollama…');
    patch({
      semanticIndex: {
        ...draft.semanticIndex,
        enabled: true,
        source: 'ollama' as const,
        backend: 'ollama' as const,
        model: NOMIC_EMBED_MODEL,
        dimensions: 0,
        normalized: true,
      },
    });
    try {
      const result = await pullOllamaEmbeddingModel({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        model: NOMIC_EMBED_MODEL,
        providerBaseUrl: ollamaEmbeddingBaseUrl,
        onProgress: (progress) => {
          if (progress.percent !== undefined) {
            setNomicProgress(progress.percent);
          }
          setNomicNote(
            progress.percent !== undefined
              ? `Downloading Nomic… ${progress.percent}%`
              : `Downloading Nomic… ${progress.status}`,
          );
        },
      });
      if (!result.ok) {
        const unreachable = /ollama|reach|ECONNREFUSED|install/i.test(
          result.error,
        );
        setNomicStatus(unreachable ? 'unreachable' : 'missing');
        setNomicProgress(undefined);
        setNomicNote(result.error);
        return;
      }
      setNomicStatus('ready');
      setNomicProgress(100);
      setNomicNote(
        'Nomic Embed Text is ready. Save settings, then reindex this workspace.',
      );
    } catch (err) {
      setNomicStatus('unreachable');
      setNomicProgress(undefined);
      setNomicNote(err instanceof Error ? err.message : String(err));
    }
  };

  const useNomicNow = () => {
    patch({
      semanticIndex: {
        ...draft.semanticIndex,
        enabled: true,
        source: 'ollama' as const,
        backend: 'ollama' as const,
        model: NOMIC_EMBED_MODEL,
        dimensions: 0,
        normalized: true,
      },
    });
    setNomicNote(
      'Using Nomic Embed Text. Save settings, then reindex this workspace.',
    );
  };

  const page = PAGE_COPY[tab];

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      await props.onSave({
        settings: draft,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
        ...(searchApiKey.trim() ? { searchApiKey: searchApiKey.trim() } : {}),
        ...(clearSearchApiKey ? { clearSearchApiKey: true } : {}),
      });
      setApiKey('');
      setClearApiKey(false);
      setSearchApiKey('');
      setClearSearchApiKey(false);
      setNote('Saved. Settings applied.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return {
    props,
    featureTab,
    draft,
    patch,
    searchApiKey,
    clearSearchApiKey,
    setSearchApiKey,
    setClearSearchApiKey,
    indexMessage,
    nomicNote,
    nomicStatus,
    nomicProgress,
    useNomicNow,
    downloadNomic,
    reindexing,
    setReindexing,
    setIndexMessage,
    ollamaEmbeddingBaseUrl,
    tab,
    setDraft,
    saving,
    featureTabs,
    setFeatureTab,
    storageBusy,
    setStorageBusy,
    setStorageNote,
    refreshStorage,
    storageNote,
    storage,
    contextNote,
    memories,
    contextBusy,
    setContextBusy,
    setContextNote,
    setMemories,
    checkpoints,
    setCheckpoints,
    setNote,
    save,
    setApiKey,
    setClearApiKey,
    note,
    setTab,
    page,
  };
}

export type SettingsModel = ReturnType<typeof useSettingsPanelModel>;
