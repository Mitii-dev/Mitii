import { attachPreDecideMaterials } from "../../helpers/orient/AttachPreDecideMaterials";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { StepContext } from "./StepContext";

/**
 * Step 2b — optional skills/memory peek before assess/decide (S1-MOVE-MEM-SKILL).
 */
export async function attachPreDecideMaterialsStep(
  ctx: StepContext,
): Promise<SituationPack | undefined> {
  const pack = ctx.store.getSlice<SituationPack>("situationPack");
  if (!pack) return undefined;

  const result = await attachPreDecideMaterials({
    pack,
    enrich: ctx.deps?.enrich,
    query: pack.request?.text ?? pack.requestText ?? ctx.input.message,
    skillIds: ctx.input.requiredSkillIds,
    focusPaths: pack.scope?.focusPaths,
  });

  if (result.reasonCodes.some((c) => c.startsWith("pre_decide_"))) {
    ctx.store.setSlice("situationPack", result.pack);
    ctx.store.setSlice("preDecideMaterials", {
      reasonCodes: result.reasonCodes,
    });
  }
  return result.pack;
}
