/** @-mention and pin suggestion menu logic. */

import { detectMentionSuggest, stripTrailingMention } from '@mitii/ui-core';
import { searchWorkspacePaths } from '../../api.js';
import type { useComposerState } from './useComposerState.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useProviderState } from '../../settings/hooks/useProviderState.js';

export type SuggestItem =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'skill'; id: string; title: string; description: string }
  | { kind: 'mcp'; id: string; name: string; enabled: boolean };

export function useMentionSuggest(deps: Pick<
    ReturnType<typeof useComposerState>,
    'setPinMenu' | 'setMention' | 'setPathHits' | 'setSuggestIndex'
    | 'setSuggestLoading' | 'searchReq' | 'mention' | 'pathHits' | 'setInput'
    | 'setPinnedPaths' | 'textareaRef' | 'setPinnedSkillIds' | 'setPinnedMcpIds' | 'input'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'engine'
  > &
  Pick<
    ReturnType<typeof useProviderState>,
    'skills' | 'mcpServers'
  >) {
  const {
    setPinMenu,
    setMention,
    setPathHits,
    setSuggestIndex,
    setSuggestLoading,
    searchReq,
    mention,
    pathHits,
    setInput,
    setPinnedPaths,
    textareaRef,
    setPinnedSkillIds,
    setPinnedMcpIds,
    input,
    engine,
    skills,
    mcpServers,
  } = deps;

  const closeSuggest = () => {
    setPinMenu(false);
    setMention(null);
    setPathHits([]);
    setSuggestIndex(0);
    setSuggestLoading(false);
  };

  const updateMentionFromInput = (value: string) => {
    const next = detectMentionSuggest(value);
    setMention(next);
    setSuggestIndex(0);
    if (!next) {
      setPinMenu(false);
      setPathHits([]);
      return;
    }
    setPinMenu(true);
    if (next.mode === 'all' || next.mode === 'path') {
      if (!engine) {
        setPathHits([]);
        return;
      }
      const req = ++searchReq.current;
      setSuggestLoading(true);
      void searchWorkspacePaths({
        ...engine,
        query: next.query,
      })
        .then((paths) => {
          if (req !== searchReq.current) return;
          setPathHits(paths);
        })
        .catch(() => {
          if (req !== searchReq.current) return;
          setPathHits([]);
        })
        .finally(() => {
          if (req === searchReq.current) setSuggestLoading(false);
        });
    } else {
      setPathHits([]);
      setSuggestLoading(false);
    }
  };

  const suggestItems: SuggestItem[] = (() => {
    if (!mention) return [];
    const q = mention.query;
    const items: SuggestItem[] = [];
    const wantFiles = mention.mode === 'all' || mention.mode === 'path';
    const wantSkills = mention.mode === 'all' || mention.mode === 'skill';
    const wantMcp = mention.mode === 'all' || mention.mode === 'mcp';

    if (wantSkills) {
      for (const skill of skills) {
        const hay = `${skill.id} ${skill.title} ${skill.description}`.toLowerCase();
        if (!q || hay.includes(q)) {
          items.push({
            kind: 'skill',
            id: skill.id,
            title: skill.title,
            description: skill.description,
          });
        }
      }
    }
    if (wantMcp) {
      for (const server of mcpServers) {
        const hay = `${server.id} ${server.name}`.toLowerCase();
        if (!q || hay.includes(q)) {
          items.push({
            kind: 'mcp',
            id: server.id,
            name: server.name,
            enabled: server.enabled,
          });
        }
      }
    }
    if (wantFiles) {
      for (const hit of pathHits) {
        items.push({ kind: hit.kind, path: hit.path });
      }
    }
    return items.slice(0, 48);
  })();

  const selectPathMention = (path: string) => {
    setInput((prev) => stripTrailingMention(prev));
    setPinnedPaths((prev) =>
      prev.includes(path) ? prev : [...prev, path].slice(0, 32),
    );
    closeSuggest();
    textareaRef.current?.focus();
  };

  const selectSkillMention = (id: string) => {
    setInput((prev) => stripTrailingMention(prev));
    setPinnedSkillIds((prev) =>
      prev.includes(id) ? prev : [...prev, id].slice(0, 8),
    );
    closeSuggest();
    textareaRef.current?.focus();
  };

  const selectMcpMention = (id: string) => {
    setInput((prev) => stripTrailingMention(prev));
    setPinnedMcpIds((prev) =>
      prev.includes(id) ? prev : [...prev, id].slice(0, 8),
    );
    closeSuggest();
    textareaRef.current?.focus();
  };

  const applySuggestItem = (item: SuggestItem) => {
    if (item.kind === 'file' || item.kind === 'folder') {
      selectPathMention(item.path);
    } else if (item.kind === 'skill') selectSkillMention(item.id);
    else selectMcpMention(item.id);
  };

  const openAtSuggest = () => {
    const el = textareaRef.current;
    const value = input;
    const needsAt = !/(?:^|\s)@[\w./_\- ]*$/.test(value);
    const next = needsAt
      ? `${value}${value && !/\s$/.test(value) ? ' ' : ''}@`
      : value;
    setInput(next);
    updateMentionFromInput(next);
    requestAnimationFrame(() => {
      el?.focus();
      const len = next.length;
      el?.setSelectionRange(len, len);
    });
  };

  return {
    suggestItems,
    applySuggestItem,
    updateMentionFromInput,
    closeSuggest,
    openAtSuggest,
  };
}
