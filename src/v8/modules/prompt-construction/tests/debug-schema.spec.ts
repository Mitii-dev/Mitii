import { describe, expect, it } from "vitest";
import {
  modelCapabilitiesSchema,
  modelMessageSchema,
  modelToolDefinitionSchema,
} from "../../model-gateway";
import { executionDecisionSchema } from "../../decision-policy";
import { promptConstructionInputSchema } from "../contracts/input/PromptConstructionInput";

describe("debug schemas", () => {
  it("are defined", () => {
    console.log({
      caps: modelCapabilitiesSchema,
      msg: modelMessageSchema,
      tool: modelToolDefinitionSchema,
      decision: executionDecisionSchema,
      promptShape: promptConstructionInputSchema,
    });
    expect(modelCapabilitiesSchema).toBeDefined();
    expect(modelMessageSchema).toBeDefined();
    expect(modelToolDefinitionSchema).toBeDefined();
    expect(executionDecisionSchema).toBeDefined();
    expect(promptConstructionInputSchema).toBeDefined();
  });
});
