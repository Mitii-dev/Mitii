import {
  directionInputFromSituationPack,
} from "../../../modules/request-understanding/helpers/direction/AssessDirection";
import {
  assessDirectionWithLlm,
} from "../../../modules/request-understanding/helpers/direction/AssessDirectionWithLlm";
import type { TaskDirectionAssessment } from "../../contracts/assess/TaskDirectionAssessment";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { StepContext } from "./StepContext";

/**
 * Step 3 — Direction ballot via RU.assessDirectionWithLlm.
 * Uses RuntimeModelPort when present; else deterministic. DP owns authority.
 */
export async function assessDirection(
  ctx: StepContext,
  situation?: SituationPack,
): Promise<TaskDirectionAssessment> {
  const pack =
    situation ??
    (ctx.store.getSlice<SituationPack>("situationPack") as SituationPack);

  const base = directionInputFromSituationPack(
    pack ?? {
      requestText: ctx.input.message,
      mode: ctx.mode,
    },
  );
  const input = {
    ...base,
    turnKind: ctx.input.turnKind ?? base.turnKind ?? "new",
  };

  const model = ctx.deps?.model;
  const assessment = await assessDirectionWithLlm(
    input,
    model
      ? async ({ system, user }) => {
          const response = await model.complete(
            {
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              tools: [],
            },
            { abortSignal: ctx.abortSignal },
          );
          return response.text;
        }
      : undefined,
  );

  ctx.store.setSlice("assessment", assessment);
  return assessment;
}
