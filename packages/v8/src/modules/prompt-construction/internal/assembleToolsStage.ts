import { serializeTools, updateSectionBudget } from "../actions";
import type {
  PromptConstructionInput,
  TokenEstimatorPort,
} from "../contracts";
import {
  sectionAllocation,
  type PromptAssemblyState,
} from "./promptAssemblyState";

type SerializedTools = ReturnType<typeof serializeTools>;

/** Serializes granted tools within budget and aligns the "Allowed tools" prose. */
export function assembleToolsStage(params: {
  parsed: PromptConstructionInput;
  state: PromptAssemblyState;
  estimator: TokenEstimatorPort;
  systemContent: string;
}): { toolsResult: SerializedTools; systemContent: string } {
  const { parsed, state, estimator } = params;
  const { reasonCodes, omissions } = state;
  let { systemContent } = params;
  let sections = state.sections;
  const sectionAlloc = (
    name: (typeof sections)[number]["section"],
  ): number => sectionAllocation(sections, name);

  const toolsResult = serializeTools({
    decision: parsed.decision,
    tools: parsed.tools,
    capabilities: parsed.capabilities,
    estimator: estimator,
    budgetTokens: sectionAlloc("tools"),
  });
  for (const code of toolsResult.reasonCodes) {
    if (code === "tools_omitted_unsupported") {
      reasonCodes.push("tools_omitted_unsupported");
    } else if (code === "tools_filtered_by_grant") {
      reasonCodes.push("tools_filtered_by_grant");
    }
  }
  for (const omission of toolsResult.omissions) {
    omissions.push({
      section: "tools",
      reason:
        omission.detail === "capability_unsupported"
          ? "capability_unsupported"
          : omission.detail === "grant_empty"
            ? "grant_empty"
            : "budget",
      detail: `Tool ${omission.source} omitted (${omission.detail})`,
      tokens: omission.tokens,
      source: omission.source,
    });
  }
  sections = updateSectionBudget(sections, "tools", {
    usedTokens: toolsResult.usedTokens,
    omittedTokens: toolsResult.omittedTokens,
  });

  // Keep "Allowed tools:" prose aligned with schemas actually attached.
  // Otherwise models refuse apply_patch when the grant lists it but budget
  // packing previously dropped the definition (or vice versa after resume).
  if (toolsResult.tools && toolsResult.tools.length > 0) {
    const allowedLine = `Allowed tools: ${toolsResult.tools
      .map((tool) => tool.name)
      .join(", ")}.`;
    systemContent = systemContent.replace(
      /Allowed tools: [^\n]+/,
      allowedLine,
    );
  }

  state.sections = sections;
  return { toolsResult, systemContent };
}
