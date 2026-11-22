import { type AppApi } from '../app/appApi';
import { type HostToWebviewMessage } from '../protocol';
import { skillCatalogSuggestSideEffects } from '../skillSuggest';

export function handleComposerMessage(msg: HostToWebviewMessage, api: AppApi): boolean {
  const {
    dismissedAutoPinsRef,
    lastSearchId,
    setActiveSuggest,
    setPinned,
    setSkillItems,
    setSuggestLoading,
    setSuggestOpen,
    setSuggestions,
  } = api;

  let handled = true;
  switch (msg.type) {
    case 'paths.results':
      if (msg.requestId === lastSearchId.current) {
        setSuggestions(msg.suggestions);
        setSuggestLoading(false);
        setSuggestOpen(true);
        setActiveSuggest(0);
      }
      break;
    case 'editorPin':
      setPinned((prev) => {
        const source = msg.source ?? 'auto';
        if (source === 'user') {
          dismissedAutoPinsRef.current.delete(msg.path);
        } else if (dismissedAutoPinsRef.current.has(msg.path)) {
          return prev;
        }
        const existing = prev.find((p) => p.path === msg.path);
        if (existing) {
          // Promote auto → user when explicitly pinned again as user.
          if (source === 'user' && existing.source === 'auto') {
            return prev.map((p) =>
              p.path === msg.path ? { ...p, source: 'user' } : p,
            );
          }
          return prev;
        }
        return [...prev, { path: msg.path, source }];
      });
      break;
    case 'editorUnpin':
      setPinned((prev) =>
        prev.filter(
          (p) => !(p.path === msg.path && p.source === 'auto'),
        ),
      );
      break;
    case 'syncAutoPins': {
      const open = new Set(msg.paths);
      // Keep user dismissals for the rest of the session. Clearing them when
      // a tab briefly leaves the open set made removed pins come right back.
      setPinned((prev) => {
        const kept = prev.filter(
          (p) => p.source === 'user' || open.has(p.path),
        );
        const known = new Set(kept.map((p) => p.path));
        const additions = msg.paths
          .filter(
            (path) =>
              !known.has(path) &&
              !dismissedAutoPinsRef.current.has(path),
          )
          .map((path) => ({ path, source: 'auto' as const }));
        return [...kept, ...additions];
      });
      break;
    }
    case 'skillCatalogResult': {
      const suggestEffects = skillCatalogSuggestSideEffects(
        msg.requestId,
        lastSearchId.current,
      );
      if (!suggestEffects) {
        break;
      }
      setSkillItems(msg.items);
      setSuggestLoading(false);
      setSuggestOpen(suggestEffects.suggestOpen);
      setActiveSuggest(suggestEffects.activeSuggest);
      break;
    }
    default:
      handled = false;
  }
  return handled;
}
