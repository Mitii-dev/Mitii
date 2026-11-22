/** Skill / MCP pin toggles. */

import type { useComposerState } from './useComposerState.js';

export function usePins(deps: Pick<
    ReturnType<typeof useComposerState>,
    'setPinnedSkillIds' | 'setPinnedMcpIds' | 'pinnedPaths' | 'pinnedSkillIds'
    | 'pinnedMcpIds'
  >) {
  const {
    setPinnedSkillIds,
    setPinnedMcpIds,
    pinnedPaths,
    pinnedSkillIds,
    pinnedMcpIds,
  } = deps;

  const toggleSkillPin = (id: string) => {
    setPinnedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleMcpPin = (id: string) => {
    setPinnedMcpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const hasPins =
    pinnedPaths.length > 0 ||
    pinnedSkillIds.length > 0 ||
    pinnedMcpIds.length > 0;

  return {
    hasPins,
    toggleSkillPin,
    toggleMcpPin,
  };
}
