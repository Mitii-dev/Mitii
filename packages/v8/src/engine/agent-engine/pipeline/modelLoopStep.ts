import type { ToolLoopOutcome } from "./types";

/** Control flow result for one slice of the model/tool loop. */
export type ModelLoopStepResult =
  | { kind: "continue" }
  | { kind: "return"; outcome: ToolLoopOutcome };
