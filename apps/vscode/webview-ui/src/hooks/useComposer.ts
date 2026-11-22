import { useCallback, useEffect, useRef, useState } from 'react';
import { modeDefaultsFromUi } from '../app/modeSettings';
import { DEFAULT_CODE_REVIEW_PROMPT, mergeReviewSkillIds } from '../app/reviewHelpers';
import { postToHost } from '../bridge';
import { normalizeApproval } from '../approvalPresets';
import { type ContextPin } from '../components/ContextPanel';
import { enabledMcpSuggestItems, filterMcpSuggestions, togglePinnedMcpServer } from '../mcpSuggest';
import { type PathSuggestion, type SkillCatalogItem } from '../protocol';
import { filterSkillSuggestions } from '../skillSuggest';
import { detectMentionSuggest, resolveRunIntensity, stripTrailingMention } from '@mitii/ui-core';
import type { IntensityApi } from './useIntensity';
import type { SettingsStateApi } from './useSettingsState';
import type { RunStreamApi } from './useRunStream';
import type { ReviewStateApi } from './useReviewState';
import type { SettingsActionsApi } from './useSettingsActions';

export function useComposer(deps: IntensityApi & SettingsStateApi & RunStreamApi & ReviewStateApi & SettingsActionsApi) {
  const {
    approvalMode,
    forceScrollToBottomRef,
    mcp,
    mode,
    plan,
    reviewFindings,
    runReviewRef,
    running,
    saveModel,
    setApprovalMode,
    setDepth,
    setEffort,
    setMode,
    setReviewBarExpandToken,
    setThoroughness,
    stickToBottomRef,
    turns,
    ui,
  } = deps;

  const [prompt, setPrompt] = useState('');
  const [pinned, setPinned] = useState<ContextPin[]>([]);
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>([]);
  const [pinnedMcpServerIds, setPinnedMcpServerIds] = useState<string[]>([]);

  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestKind, setSuggestKind] = useState<
    'path' | 'skill' | 'mcp' | 'all'
  >('path');
  const [activeSuggest, setActiveSuggest] = useState(0);

  const [skillItems, setSkillItems] = useState<SkillCatalogItem[]>([]);

  const searchReq = useRef(0);
  const lastSearchId = useRef('');
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const dismissedAutoPinsRef = useRef(new Set<string>());

  const send = useCallback(() => {
    const text = prompt.trim();
    if (!text || running) return;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    const uiMode =
      mode === 'review' ? 'ask' : mode === 'database' ? 'database' : mode;
    const defaults = modeDefaultsFromUi(ui, uiMode);
    const intensity = resolveRunIntensity({
      intensityOverrides: ui.intensityOverrides === true,
      thoroughness: defaults.thoroughness,
      depth: defaults.depth,
      effort: ui.effort,
    });
    postToHost({
      type: 'ask',
      prompt: text,
      mode: uiMode,
      depth: intensity.depth,
      effort: intensity.effort,
      approvalMode,
      pinnedPaths: pinned.map((p) => p.path),
      requiredSkillIds: pinnedSkillIds,
      requiredMcpServerIds: pinnedMcpServerIds,
    });
    setPrompt('');
    setPinnedSkillIds([]);
    setPinnedMcpServerIds([]);
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [prompt, running, mode, ui, approvalMode, pinned, pinnedSkillIds, pinnedMcpServerIds]);

  const runCodeReview = useCallback(
    (promptOverride?: string) => {
      if (running) return;
      const text =
        (promptOverride ?? prompt).trim() || DEFAULT_CODE_REVIEW_PROMPT;
      stickToBottomRef.current = true;
      forceScrollToBottomRef.current = true;
      const defaults = modeDefaultsFromUi(ui, 'ask');
      const intensity = resolveRunIntensity({
        intensityOverrides: ui.intensityOverrides === true,
        thoroughness: defaults.thoroughness,
        depth: defaults.depth,
        effort: ui.effort,
      });
      if (mode === 'review') setMode('ask');
      setReviewBarExpandToken((n) => n + 1);
      postToHost({
        type: 'ask',
        prompt: text,
        mode: 'review',
        reviewKind: 'code',
        depth: intensity.depth,
        effort: intensity.effort,
        approvalMode: defaults.approvalMode,
        pinnedPaths: pinned.map((p) => p.path),
        requiredSkillIds: mergeReviewSkillIds(pinnedSkillIds),
        requiredMcpServerIds: pinnedMcpServerIds,
      });
      setPrompt('');
      setPinnedSkillIds([]);
      setPinnedMcpServerIds([]);
      setSuggestLoading(false);
      setSuggestOpen(false);
    },
    [running, prompt, ui, mode, pinned, pinnedSkillIds, pinnedMcpServerIds],
  );

  useEffect(() => {
    runReviewRef.current = runCodeReview;
  }, [runCodeReview]);

  const executePendingPlan = useCallback(() => {
    if (running) return;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    const agentDefaults = modeDefaultsFromUi(ui, 'agent');
    const intensity = resolveRunIntensity({
      intensityOverrides: ui.intensityOverrides === true,
      thoroughness: agentDefaults.thoroughness,
      depth: agentDefaults.depth,
      effort: ui.effort,
    });
    setMode('agent');
    setThoroughness(intensity.thoroughness);
    setDepth(intensity.depth);
    setEffort(intensity.effort);
    setApprovalMode(normalizeApproval(agentDefaults.approvalMode));
    const nextModel = agentDefaults.model?.trim();
    if (nextModel) saveModel(nextModel, { clearStaleModeDefaults: false });
    postToHost({
      type: 'ask',
      prompt: 'Implement the pending plan.',
      mode: 'agent',
      depth: intensity.depth,
      effort: intensity.effort,
      approvalMode: agentDefaults.approvalMode,
      pinnedPaths: pinned.map((p) => p.path),
      requiredSkillIds: pinnedSkillIds,
      requiredMcpServerIds: pinnedMcpServerIds,
    });
    setPrompt('');
    setPinnedSkillIds([]);
    setPinnedMcpServerIds([]);
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [running, ui, pinned, pinnedSkillIds, pinnedMcpServerIds]);

  const onPromptChange = (value: string) => {
    setPrompt(value);
    const mention = detectMentionSuggest(value);
    if (!mention) {
      setSuggestLoading(false);
      setSuggestOpen(false);
      return;
    }

    setSuggestKind(mention.mode);
    setSuggestQuery(mention.query);
    setActiveSuggest(0);
    setSuggestOpen(true);

    if (mention.mode === 'mcp') {
      setSuggestLoading(false);
      return;
    }

    const requestId = String(++searchReq.current);
    lastSearchId.current = requestId;
    setSuggestLoading(true);

    if (mention.mode === 'skill' || mention.mode === 'all') {
      postToHost({
        type: 'requestSkillCatalog',
        requestId,
        query: mention.query || undefined,
      });
    }
    if (mention.mode === 'path' || mention.mode === 'all') {
      postToHost({
        type: 'paths.search',
        query: mention.query,
        requestId,
      });
    }
  };

  const insertMention = (path: string) => {
    // Pin only — strip the trailing @partial from the prompt.
    setPrompt((prev) => stripTrailingMention(prev));
    dismissedAutoPinsRef.current.delete(path);
    setPinned((prev) => {
      const existing = prev.find((p) => p.path === path);
      if (existing) {
        return existing.source === 'user'
          ? prev
          : prev.map((p) =>
              p.path === path ? { ...p, source: 'user' } : p,
            );
      }
      return [...prev, { path, source: 'user' }];
    });
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const insertSkillMention = (skillId: string) => {
    setPrompt((prev) =>
      prev
        .replace(/@skill:?[a-z0-9_.-]*$/i, '')
        .replace(/@$/i, '')
        .replace(/[ \t]+$/g, ''),
    );
    setPinnedSkillIds((prev) =>
      prev.includes(skillId) ? prev : [...prev, skillId].slice(0, 3),
    );
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const pinSkill = (skillId: string) => {
    setPinnedSkillIds((prev) =>
      prev.includes(skillId) ? prev : [...prev, skillId].slice(0, 3),
    );
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const selectSkill = (skillId: string) => {
    if (/@skill:?[a-z0-9_.-]*$/i.test(prompt) || /@$/i.test(prompt)) {
      insertSkillMention(skillId);
      return;
    }
    pinSkill(skillId);
  };

  const selectMcp = (serverId: string) => {
    if (/@mcp:?[a-z0-9_-]*$/i.test(prompt) || /@$/i.test(prompt)) {
      setPrompt((prev) =>
        prev
          .replace(/@mcp:?[a-z0-9_-]*$/i, '')
          .replace(/@$/i, '')
          .replace(/[ \t]+$/g, ''),
      );
    }
    setPinnedMcpServerIds((prev) => togglePinnedMcpServer(prev, serverId));
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const openSkillPicker = () => {
    setSuggestKind('skill');
    setSuggestQuery('');
    setActiveSuggest(0);
    const requestId = String(++searchReq.current);
    lastSearchId.current = requestId;
    setSuggestLoading(true);
    setSuggestOpen(true);
    postToHost({
      type: 'requestSkillCatalog',
      requestId,
      query: undefined,
    });
    promptTextareaRef.current?.focus();
  };

  const filteredSkillSuggestions = filterSkillSuggestions(
    skillItems,
    suggestQuery,
  );

  const filteredMcpSuggestions = filterMcpSuggestions(
    enabledMcpSuggestItems(mcp.enabled ? mcp.servers : []),
    suggestQuery,
  );

  type CombinedSuggestItem =
    | { type: 'skill'; id: string; label: string; sub: string }
    | { type: 'mcp'; id: string; label: string; sub: string }
    | { type: 'path'; id: string; label: string; sub: string };

  const allSuggestItems: CombinedSuggestItem[] =
    suggestKind === 'all'
      ? [
          ...filteredSkillSuggestions.map((item) => ({
            type: 'skill' as const,
            id: `skill:${item.id}`,
            label: `@skill:${item.id}`,
            sub: item.name,
          })),
          ...filteredMcpSuggestions.map((item) => ({
            type: 'mcp' as const,
            id: `mcp:${item.id}`,
            label: `@mcp:${item.id}`,
            sub: item.name,
          })),
          ...suggestions.map((item) => ({
            type: 'path' as const,
            id: `path:${item.path}`,
            label: `@${item.path}`,
            sub: item.kind,
          })),
        ]
      : [];

  const fixReviewFindings = useCallback(
    (indices?: number[]) => {
      if (running) return;
      const latestRunId = [...turns]
        .reverse()
        .find((t) => t.fileChanges)?.fileChanges?.runId;
      setMode('agent');
      const agentDefaults = modeDefaultsFromUi(ui, 'agent');
      const intensity = resolveRunIntensity({
        intensityOverrides: ui.intensityOverrides === true,
        thoroughness: agentDefaults.thoroughness,
        depth: agentDefaults.depth,
        effort: ui.effort,
      });
      setThoroughness(intensity.thoroughness);
      setDepth(intensity.depth);
      setEffort(intensity.effort);
      setApprovalMode(normalizeApproval(agentDefaults.approvalMode));
      const openIndices =
        indices ??
        reviewFindings
          .map((f, i) => (f.status === 'fixed' ? -1 : i))
          .filter((i) => i >= 0);
      if (openIndices.length === 0) return;
      postToHost({
        type: 'fixReviewFindings',
        indices: openIndices,
        runId: latestRunId,
      });
    },
    [running, turns, ui, reviewFindings],
  );

  const followingPlan = mode === 'plan' && Boolean(plan?.steps.length);

  return {
    prompt,
    setPrompt,
    pinned,
    setPinned,
    pinnedSkillIds,
    setPinnedSkillIds,
    pinnedMcpServerIds,
    setPinnedMcpServerIds,
    suggestions,
    setSuggestions,
    suggestOpen,
    setSuggestOpen,
    suggestLoading,
    setSuggestLoading,
    suggestQuery,
    setSuggestQuery,
    suggestKind,
    setSuggestKind,
    activeSuggest,
    setActiveSuggest,
    skillItems,
    setSkillItems,
    searchReq,
    lastSearchId,
    promptTextareaRef,
    dismissedAutoPinsRef,
    send,
    runCodeReview,
    executePendingPlan,
    onPromptChange,
    insertMention,
    insertSkillMention,
    pinSkill,
    selectSkill,
    selectMcp,
    openSkillPicker,
    filteredSkillSuggestions,
    filteredMcpSuggestions,
    allSuggestItems,
    fixReviewFindings,
    followingPlan,
  };
}

export type ComposerApi = ReturnType<typeof useComposer>;
