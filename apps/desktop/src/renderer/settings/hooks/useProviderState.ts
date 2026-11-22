/** Provider profiles, models, skills and MCP catalog state. */

import { useState, useRef } from 'react';
import { type ModelCostRates } from '@mitii/ui-core';
import { type ProfileRow } from '../profileTypes.js';

export function useProviderState() {
  const [costRates, setCostRates] = useState<ModelCostRates | null>(null);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  const [activeProfileId, setActiveProfileId] = useState('');

  const [knownModels, setKnownModels] = useState<string[]>([]);

  const [modelsLoading, setModelsLoading] = useState(false);

  const modelsProfileRef = useRef<string>('');

  const [skills, setSkills] = useState<
    Array<{ id: string; title: string; description: string }>
  >([]);

  const [mcpServers, setMcpServers] = useState<
    Array<{ id: string; name: string; enabled: boolean }>
  >([]);

  const [mcpMasterEnabled, setMcpMasterEnabled] = useState(false);

  const [mcpStatusReady, setMcpStatusReady] = useState(false);

  return {
    setCostRates,
    profiles,
    activeProfileId,
    setMcpMasterEnabled,
    setMcpServers,
    setProfiles,
    setActiveProfileId,
    setKnownModels,
    modelsProfileRef,
    setModelsLoading,
    setSkills,
    setMcpStatusReady,
    skills,
    mcpServers,
    mcpStatusReady,
    mcpMasterEnabled,
    costRates,
    knownModels,
    modelsLoading,
  };
}
