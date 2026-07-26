import {
  MODEL_GATEWAY_IDS,
  MODEL_GATEWAY_LIMITS,
} from "../constants";
import { ModelCapabilityResolver } from "../ModelCapabilityResolver";
import type {
  LlmPort,
  ModelCallContext,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
} from "../contracts/types";

export interface EchoLlmPortOptions {
  id?: string;
  modelId?: string;
  contextWindowTokens?: number;
  chunkCharacters?: number;
}

/**
 * Deterministic LlmPort for local tests and offline smoke runs.
 * Echoes the last user message; never contacts a network provider.
 */
export class EchoLlmPort implements LlmPort {
  public readonly id: string;
  public readonly capabilities: ModelCapabilities;

  private readonly chunkCharacters: number;

  constructor(options: EchoLlmPortOptions = {}) {
    this.id = options.id ?? MODEL_GATEWAY_IDS.ECHO_PORT;
    this.chunkCharacters =
      options.chunkCharacters ??
      MODEL_GATEWAY_LIMITS.ECHO_CHUNK_CHARACTERS;

    this.capabilities = new ModelCapabilityResolver().resolve({
      modelId: options.modelId ?? "echo/local",
      contextWindowTokens:
        options.contextWindowTokens ??
        MODEL_GATEWAY_LIMITS.MINIMUM_CONTEXT_WINDOW_TOKENS * 8,
      supportsStreaming: true,
      supportsTools: false,
    });
  }

  public async *complete(
    request: ModelRequest,
    context?: ModelCallContext,
  ): AsyncIterable<ModelEvent> {
    if (context?.abortSignal?.aborted) {
      yield {
        type: "cancelled",
        error: {
          code: "cancelled",
          message: "Request was aborted before completion.",
          retryable: false,
        },
      };
      return;
    }

    const lastUser = [...request.messages]
      .reverse()
      .find((message) => message.role === "user");

    const response = `Echo: ${lastUser?.content ?? ""}`;

    for (
      let index = 0;
      index < response.length;
      index += this.chunkCharacters
    ) {
      if (context?.abortSignal?.aborted) {
        yield {
          type: "cancelled",
          error: {
            code: "cancelled",
            message: "Request was aborted during streaming.",
            retryable: false,
          },
        };
        return;
      }

      yield {
        type: "content_delta",
        content: response.slice(index, index + this.chunkCharacters),
      };
    }

    yield {
      type: "completed",
      finishReason: "stop",
    };
  }

  public async countTokens(text: string): Promise<number> {
    return Math.max(
      1,
      Math.ceil(
        text.length / MODEL_GATEWAY_LIMITS.APPROXIMATE_CHARS_PER_TOKEN,
      ),
    );
  }
}
