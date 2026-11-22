import { useEffect, useRef, useState } from 'react';
import { type ApprovalUiMode } from '../approvalPresets';
import { modeColor } from '../modeColors';
import { type AgentUiDepth, type AgentUiEffort, type AgentUiMode, type AgentUiThoroughness } from '../protocol';

export function useIntensity() {
  const [mode, setMode] = useState<AgentUiMode>('ask');
  const [depth, setDepth] = useState<AgentUiDepth>('auto');
  const [effort, setEffort] = useState<AgentUiEffort>('medium');
  const [thoroughness, setThoroughness] =
    useState<AgentUiThoroughness>('medium');
  const [approvalMode, setApprovalMode] = useState<ApprovalUiMode>('guided');

  const modeRef = useRef<AgentUiMode>(mode);

  const hydratedModeDefaults = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const currentModeColor = modeColor(mode);

  return {
    mode,
    setMode,
    depth,
    setDepth,
    effort,
    setEffort,
    thoroughness,
    setThoroughness,
    approvalMode,
    setApprovalMode,
    modeRef,
    hydratedModeDefaults,
    currentModeColor,
  };
}

export type IntensityApi = ReturnType<typeof useIntensity>;
