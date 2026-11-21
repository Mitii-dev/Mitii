import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mergeModelOptions } from '../../app/modelOptions';
import { COMPACT_MAX_WIDTH, NAV, PAGE_COPY } from './nav';
import { type SettingsPanelProps } from './types';
import { deriveLiveTokenBudgetPreview, isAutoMaximumOutputTokens, normalizeMaximumOutputTokens, resolvePreviewContextWindow } from '@mitii/ui-core';

export function useSettingsPanelState(props: SettingsPanelProps) {
  const {
    activeProfileId,
    index,
    modelOptions,
    profiles,
    provider,
    tab,
    ui,
  } = props;

  const [modeSettingsTab, setModeSettingsTab] =
    useState<'ask' | 'plan' | 'agent'>('ask');
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [draftContextWindow, setDraftContextWindow] = useState<
    number | undefined
  >();
  const [draftMaxOutput, setDraftMaxOutput] = useState<number | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [iconTooltip, setIconTooltip] = useState<{
    label: string;
    top: number;
  } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') {
      return;
    }
    const update = () => {
      setCompact(root.clientWidth <= COMPACT_MAX_WIDTH);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!compact) setIconTooltip(null);
  }, [compact]);

  const showIconTooltip = useCallback(
    (label: string, target: HTMLElement) => {
      const root = rootRef.current;
      if (!root || root.clientWidth > COMPACT_MAX_WIDTH) {
        setIconTooltip(null);
        return;
      }
      const rootBox = root.getBoundingClientRect();
      const itemBox = target.getBoundingClientRect();
      setIconTooltip({
        label,
        top: itemBox.top - rootBox.top + itemBox.height / 2,
      });
    },
    [],
  );

  const hideIconTooltip = useCallback(() => {
    setIconTooltip(null);
  }, []);

  const options = useMemo(
    () =>
      mergeModelOptions(
        [
          ...modelOptions,
          ...Object.values(ui.modeDefaults ?? {})
            .map((entry) => entry.model ?? '')
            .filter(Boolean),
        ],
        provider.model,
      ),
    [modelOptions, provider.model, ui.modeDefaults],
  );

  const activeTab = NAV.some((item) => item.id === tab) ? tab : 'model';
  const page = PAGE_COPY[activeTab];
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const modeDefault =
    ui.modeDefaults?.[modeSettingsTab] ?? {
      thoroughness: 'medium' as const,
      depth: ui.depth,
      approvalMode: ui.approvalMode,
      model: provider.model,
    };
  const embeddingsDegraded = index.capabilities?.some(
    (capability) =>
      capability.capability === 'vectorIndex' &&
      capability.status === 'degraded',
  );
  const keyRequired =
    provider.type === 'anthropic' || provider.type === 'gemini';
  const previewContextWindow = resolvePreviewContextWindow({
    draft: draftContextWindow,
    stored: provider.contextWindow,
    effective: provider.effectiveContextWindow,
    fallback: ui.tokenBudget.preview.contextWindowTokens,
  });
  const storedMaxOutput = normalizeMaximumOutputTokens(provider.maximumOutputTokens);
  const previewMaxOutput = normalizeMaximumOutputTokens(
    draftMaxOutput ?? storedMaxOutput,
  );
  const autoMaxOutput = isAutoMaximumOutputTokens(previewMaxOutput);
  const livePreview = useMemo(() => {
    try {
      return deriveLiveTokenBudgetPreview({
        contextWindowTokens: previewContextWindow,
        maximumOutputTokens: previewMaxOutput,
        policy: ui.tokenBudget.enabled ? ui.tokenBudget.policy : undefined,
        runBudget: ui.runBudget,
      });
    } catch {
      return ui.tokenBudget.preview;
    }
  }, [
    previewContextWindow,
    previewMaxOutput,
    ui.runBudget,
    ui.tokenBudget.enabled,
    ui.tokenBudget.policy,
    ui.tokenBudget.preview,
  ]);
  // When max output is auto (0), show the window-derived reserve so it tracks
  // context-window edits live. Typing a positive value pins an override.
  const displayMaxOutput = autoMaxOutput
    ? livePreview.maximumOutputTokens
    : previewMaxOutput;

  return {
    modeSettingsTab,
    setModeSettingsTab,
    newProfileOpen,
    setNewProfileOpen,
    newProfileName,
    setNewProfileName,
    draftContextWindow,
    setDraftContextWindow,
    draftMaxOutput,
    setDraftMaxOutput,
    rootRef,
    compact,
    setCompact,
    iconTooltip,
    setIconTooltip,
    showIconTooltip,
    hideIconTooltip,
    options,
    activeTab,
    page,
    activeProfile,
    modeDefault,
    embeddingsDegraded,
    keyRequired,
    previewContextWindow,
    storedMaxOutput,
    previewMaxOutput,
    autoMaxOutput,
    livePreview,
    displayMaxOutput,
  };
}

export type SettingsPanelView = ReturnType<typeof useSettingsPanelState>;
