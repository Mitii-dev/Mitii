/**
 * Enrichment-tail skills + memory retrieval.
 */
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import type { PromptInstructions } from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  extractMemoryFileTargets,
  selectSkillsForEnrichment,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";

export async function retrieveEnrichmentSkillsAndMemory(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  contextPaths: string[];
  signal: AbortSignal;
}): Promise<{
  selectedSkills: PromptInstructions["skills"];
  skillCatalogL1: Awaited<
    ReturnType<typeof selectSkillsForEnrichment>
  >["skillCatalogL1"];
  selectedMemory: PromptInstructions["memory"];
}> {
  const {
    runtime,
    runId,
    input,
    bus,
    windowPolicy,
    reasonCodes,
    warnings,
    envelope,
    understanding,
    decision,
    contextPaths,
    signal,
  } = params;

  // --- Skills (optional) ---
  const { selectedSkills, skillCatalogL1 } = await selectSkillsForEnrichment({
    runtime,
    runId,
    input,
    bus,
    windowPolicy,
    reasonCodes,
    warnings,
    envelope,
    understanding,
    decision,
    contextPaths,
  });

  // --- Memory (optional) ---
  let selectedMemory: PromptInstructions["memory"];
  const workspaceId = envelope.workspace?.workspaceId;
  if (runtime.deps.memory && workspaceId) {
    runtime.emitStage(bus, runId, "memory_ready", "started");
    const memoryFileTargets = extractMemoryFileTargets(understanding);
    const memoryResult = await runtime.deps.memory.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: extractPrimaryUserMessage(envelope.message),
      scope: { kind: "workspace", workspaceId },
      now: runtime.isoNow(),
      mode: "default",
      deferAccess: true,
      signal,
      origin: envelope.origin === "user" ? "user" : "automation",
      ...(memoryFileTargets.length > 0
        ? { fileTargets: memoryFileTargets }
        : {}),
    });
    const layered = memoryResult.layers;
    selectedMemory = (
      layered
        ? [...layered.l1Index, ...layered.l2Timeline, ...layered.l3Facts]
        : memoryResult.instructions
    ).map((block) => ({
      id: block.id,
      title: block.title,
      content: block.content,
      priority: block.priority,
      memoryProvenance: block.provenance,
    }));
    warnings.push(...memoryResult.warnings);
    reasonCodes.push(
      memoryResult.instructions.length > 0
        ? "memory_retrieved"
        : memoryResult.status === "empty"
          ? "memory_empty"
          : "memory_skipped",
    );
    runtime.emit(bus, {
      type: "memory_ready",
      runId,
      selectedCount: memoryResult.instructions.length,
      omittedCount: memoryResult.omissions.length,
      status: memoryResult.status,
      at: runtime.isoNow(),
    });
    runtime.emitStage(bus, runId, "memory_ready", "completed", [
      memoryResult.instructions.length > 0
        ? "memory_retrieved"
        : memoryResult.status === "empty"
          ? "memory_empty"
          : "memory_skipped",
    ]);
  } else {
    reasonCodes.push("memory_skipped");
  }

  return { selectedSkills, skillCatalogL1, selectedMemory };
}
