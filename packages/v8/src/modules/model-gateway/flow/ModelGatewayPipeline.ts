import { MODEL_GATEWAY_STAGES } from "../constants";
import type {
  LlmPort,
  ModelCallContext,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
  ResolveModelCapabilitiesInput,
} from "../contracts";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
} from "../ports/ModuleLoggerPort";
import { resolveModelCapabilities } from "./steps";

export type ModelGatewayPipelineDependencies = {
  log?: ModuleLoggerPort;
};

/**
 * Model Gateway facade.
 *
 * Flow:
 *   1-resolve-capabilities
 *   2-complete (delegates to an injected LlmPort — adapters own wire protocol)
 *
 * Does not build prompts, authorize tools, or own run orchestration.
 */
export class ModelGatewayPipeline {
  private readonly log: ModuleLoggerPort;

  constructor(deps: ModelGatewayPipelineDependencies = {}) {
    this.log = deps.log ?? noopModuleLogger;
  }

  public resolveCapabilities(
    input: ResolveModelCapabilitiesInput,
  ): ModelCapabilities {
    const startedMs = Date.now();
    const capabilities = resolveModelCapabilities(input);
    this.log.stage({
      module: "model-gateway",
      stage: MODEL_GATEWAY_STAGES.resolveCapabilities,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      inputSummary: {
        modelId: input.modelId,
        contextWindowTokens: input.contextWindowTokens,
      },
      outputSummary: {
        maximumOutputTokens: capabilities.maximumOutputTokens,
        supportsTools: capabilities.supportsTools,
        supportsStreaming: capabilities.supportsStreaming,
      },
    });
    return capabilities;
  }

  /**
   * Stream a completion through an injected port with stage logging.
   * Prefer this when hosts want gateway-level observability without
   * changing adapter internals.
   */
  public async *complete(
    port: LlmPort,
    request: ModelRequest,
    context?: ModelCallContext,
  ): AsyncIterable<ModelEvent> {
    const startedMs = Date.now();
    let terminal: ModelEvent["type"] | undefined;
    let failedCode: string | undefined;

    try {
      for await (const event of port.complete(request, context)) {
        if (
          event.type === "completed" ||
          event.type === "failed" ||
          event.type === "cancelled"
        ) {
          terminal = event.type;
          if (event.type === "failed") {
            failedCode = event.error.code;
          }
        }
        yield event;
      }
    } finally {
      this.log.stage({
        module: "model-gateway",
        stage: MODEL_GATEWAY_STAGES.complete,
        durationMs: Date.now() - startedMs,
        reasonCodes: failedCode ? [failedCode] : [],
        inputSummary: {
          portId: port.id,
          modelId: port.capabilities.modelId,
          messageCount: request.messages.length,
          toolCount: request.tools?.length ?? 0,
          stream: request.stream ?? true,
        },
        outputSummary: {
          terminal: terminal ?? "incomplete",
        },
      });
    }
  }
}
