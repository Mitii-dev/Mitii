/** Composer inputs: mode, approvals, pins, @-mention suggest state and refs. */

import { useState, useRef } from 'react';
import { type DesktopAgentMode } from '../../../shared/protocol.js';
import {
  type ApprovalUiMode,
  type DatabaseAccessUiMode,
  type ThoroughnessUi,
  modeAccent,
} from '../ComposerControls.js';
import { type DesktopSuspension } from '../../../shared/suspension.js';
import { type MentionSuggestState } from '@mitii/ui-core';

export function useComposerState() {
  const [mode, setMode] = useState<DesktopAgentMode>('ask');

  const [approvalMode, setApprovalMode] = useState<ApprovalUiMode>('guided');

  const approvalModeRef = useRef<ApprovalUiMode>(approvalMode);

  approvalModeRef.current = approvalMode;

  /** Pilot auto-Continue without flashing the stall card. */
  const [pendingAutoContinue, setPendingAutoContinue] =
    useState<DesktopSuspension | null>(null);

  /** Cap silent Continues so reasoning-budget stalls don't spin forever. */
  const pilotAutoContinueStreakRef = useRef(0);

  const [dbAccess, setDbAccess] = useState<DatabaseAccessUiMode>('readonly');

  const [thoroughness, setThoroughness] = useState<ThoroughnessUi>('medium');

  const [input, setInput] = useState('');

  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);

  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>([]);

  const [pinnedMcpIds, setPinnedMcpIds] = useState<string[]>([]);

  const [pinMenu, setPinMenu] = useState(false);

  const [mention, setMention] = useState<MentionSuggestState | null>(null);

  const [pathHits, setPathHits] = useState<
    Array<{ path: string; kind: 'file' | 'folder' }>
  >([]);

  const [suggestIndex, setSuggestIndex] = useState(0);

  const [suggestLoading, setSuggestLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pinMenuRef = useRef<HTMLFormElement>(null);

  const searchReq = useRef(0);

  const accent = modeAccent(mode);

  return {
    textareaRef,
    input,
    pinMenu,
    pinMenuRef,
    setPinMenu,
    setMention,
    setPathHits,
    setSuggestIndex,
    setSuggestLoading,
    mode,
    setPendingAutoContinue,
    pilotAutoContinueStreakRef,
    setPinnedPaths,
    setPinnedSkillIds,
    setPinnedMcpIds,
    approvalModeRef,
    searchReq,
    mention,
    pathHits,
    setInput,
    setMode,
    setThoroughness,
    setApprovalMode,
    dbAccess,
    approvalMode,
    pinnedPaths,
    thoroughness,
    pinnedSkillIds,
    pinnedMcpIds,
    pendingAutoContinue,
    suggestLoading,
    suggestIndex,
    accent,
    setDbAccess,
  };
}
