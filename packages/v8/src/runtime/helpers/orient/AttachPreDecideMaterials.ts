/**
 * S1-MOVE-MEM-SKILL — light skills/memory peek before Decide (best-effort).
 * Does not run full enrich; stamps pack pins / memory facts when ports exist.
 */

import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { RuntimeEnrichRetrievalPorts } from "../../ports/RuntimeEnrichRetrievalPorts";

export interface AttachPreDecideMaterialsInput {
  pack: SituationPack;
  enrich?: RuntimeEnrichRetrievalPorts;
  query: string;
  skillIds?: readonly string[];
  focusPaths?: readonly string[];
}

export interface AttachPreDecideMaterialsResult {
  pack: SituationPack;
  reasonCodes: string[];
}

export async function attachPreDecideMaterials(
  input: AttachPreDecideMaterialsInput,
): Promise<AttachPreDecideMaterialsResult> {
  const reasonCodes: string[] = [];
  let pack = input.pack;
  const enrich = input.enrich;
  if (!enrich?.skills && !enrich?.memory) {
    return { pack, reasonCodes: ["pre_decide_materials_skipped_no_ports"] };
  }

  const pinnedSkills = [
    ...(input.skillIds ?? []),
    ...(pack.pins?.skillIds ?? []),
  ].slice(0, 24);

  if (enrich.skills && pinnedSkills.length > 0) {
    try {
      const selected = await enrich.skills.retrieve({
        skillIds: pinnedSkills,
        route: "answer",
        maxItems: 8,
      });
      if (selected.items.length > 0) {
        pack = {
          ...pack,
          pins: {
            skillIds: [
              ...new Set([...(pack.pins?.skillIds ?? []), ...pinnedSkills]),
            ].slice(0, 24),
            mcpIds: pack.pins?.mcpIds ?? [],
            projectRules: pack.pins?.projectRules ?? [],
            userSafetyRules: pack.pins?.userSafetyRules ?? [],
          },
        };
        reasonCodes.push(
          "pre_decide_skills_selected",
          ...selected.reasonCodes.slice(0, 4),
        );
      }
    } catch {
      reasonCodes.push("pre_decide_skills_failed");
    }
  }

  if (enrich.memory) {
    try {
      const mem = await enrich.memory.retrieve({
        query: input.query,
        focusPaths: input.focusPaths ?? pack.scope?.focusPaths,
        maxItems: 8,
      });
      if (mem.facts.length > 0) {
        pack = {
          ...pack,
          memory: {
            factCount: mem.facts.length,
          },
        };
        reasonCodes.push(
          "pre_decide_memory_retrieved",
          ...mem.reasonCodes.slice(0, 4),
        );
      }
    } catch {
      reasonCodes.push("pre_decide_memory_failed");
    }
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push("pre_decide_materials_empty");
  }
  return { pack, reasonCodes };
}
