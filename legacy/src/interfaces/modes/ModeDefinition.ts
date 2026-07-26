export interface ModeCapabilities {
  readWorkspace: boolean;
  writeWorkspace: boolean;
  executeShell: boolean;
  usePlanner: boolean;
  useSubagents: boolean;
}

export interface ModeDefinition {
  id: string;
  label: string;
  description: string;
  owner: string;
  capabilities: ModeCapabilities;
}
