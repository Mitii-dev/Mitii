/**
 * Invoke enrich retrieval ports (§11.2) — modules own pipelines; pump only calls.
 * When a port is omitted, falls back to pin/focus stubs (same as pre-port enrich).
 */

import type { RuntimeEnrichRetrievalPorts } from "../../ports/RuntimeEnrichRetrievalPorts";

export interface RetrieveEnrichMaterialsInput {
  ports?: RuntimeEnrichRetrievalPorts;
  skillIds?: readonly string[];
  query?: string;
  focusPaths?: readonly string[];
  route?: string;
  maxSkills?: number;
  maxMemory?: number;
  maxRepo?: number;
}

export interface EnrichMaterials {
  skillInstructions: string[];
  memoryFacts: string[];
  repoSlices: string[];
  reasonCodes: string[];
}

export async function retrieveEnrichMaterials(
  input: RetrieveEnrichMaterialsInput,
): Promise<EnrichMaterials> {
  const skillIds = input.skillIds ?? [];
  const focusPaths = input.focusPaths ?? [];
  const query = input.query?.trim() || "context";
  const reasonCodes: string[] = [];

  let skillInstructions: string[] = [];
  if (input.ports?.skills) {
    const result = await input.ports.skills.retrieve({
      skillIds,
      route: input.route,
      maxItems: input.maxSkills ?? 16,
    });
    skillInstructions = result.items;
    reasonCodes.push("enrich_skills_port", ...result.reasonCodes);
  } else if (skillIds.length > 0) {
    skillInstructions = skillIds.map((id) => `skill:${id}`);
    reasonCodes.push("enrich_skills_pin_stub");
  }

  let memoryFacts: string[] = [];
  if (input.ports?.memory) {
    const result = await input.ports.memory.retrieve({
      query,
      focusPaths,
      maxItems: input.maxMemory ?? 24,
    });
    memoryFacts = result.facts;
    reasonCodes.push("enrich_memory_port", ...result.reasonCodes);
  }

  let repoSlices: string[] = [];
  if (input.ports?.repo) {
    const result = await input.ports.repo.retrieve({
      focusPaths,
      maxItems: input.maxRepo ?? 24,
    });
    repoSlices = result.slices;
    reasonCodes.push("enrich_repo_port", ...result.reasonCodes);
  } else if (focusPaths.length > 0) {
    repoSlices = [...focusPaths].slice(0, input.maxRepo ?? 24);
    reasonCodes.push("enrich_repo_focus_stub");
  }

  return {
    skillInstructions,
    memoryFacts,
    repoSlices,
    reasonCodes,
  };
}
