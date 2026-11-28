/**
 * Enrich retrieval ports (§11.2) — modules own pipelines; runtime only invokes.
 * Pump must not reimplement skills/memory/repo retrieval.
 */

export interface EnrichSkillsRetrievalInput {
  skillIds: readonly string[];
  route?: string;
  maxItems?: number;
}

export interface EnrichSkillsRetrievalResult {
  items: string[];
  reasonCodes: string[];
}

export interface RuntimeSkillsRetrievalPort {
  retrieve(
    input: EnrichSkillsRetrievalInput,
  ): Promise<EnrichSkillsRetrievalResult>;
}

export interface EnrichMemoryRetrievalInput {
  query: string;
  focusPaths?: readonly string[];
  maxItems?: number;
}

export interface EnrichMemoryRetrievalResult {
  facts: string[];
  reasonCodes: string[];
}

export interface RuntimeMemoryRetrievalPort {
  retrieve(
    input: EnrichMemoryRetrievalInput,
  ): Promise<EnrichMemoryRetrievalResult>;
}

export interface EnrichRepoRetrievalInput {
  focusPaths: readonly string[];
  maxItems?: number;
}

export interface EnrichRepoRetrievalResult {
  slices: string[];
  reasonCodes: string[];
}

export interface RuntimeRepoContextRetrievalPort {
  retrieve(input: EnrichRepoRetrievalInput): Promise<EnrichRepoRetrievalResult>;
}

export interface RuntimeEnrichRetrievalPorts {
  skills?: RuntimeSkillsRetrievalPort;
  memory?: RuntimeMemoryRetrievalPort;
  repo?: RuntimeRepoContextRetrievalPort;
}
