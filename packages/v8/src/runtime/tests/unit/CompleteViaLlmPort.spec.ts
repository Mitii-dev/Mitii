import { describe, expect, it } from "vitest";

import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
} from "../../../modules/model-gateway";
import { completeViaLlmPort } from "../../adapters/model/CompleteViaLlmPort";

class ReasoningOnlyLlmPort implements LlmPort {
  readonly id = "reasoning-only";
  readonly capabilities: ModelCapabilities = {
    modelId: "reasoning/test",
    supportsStreaming: true,
    supportsTools: true,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: false,
    supportsReasoning: true,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield { type: "reasoning_delta", reasoning: "Mitii is an agent runtime." };
    yield { type: "completed", finishReason: "stop" };
  }
}

class CaptureRequestLlmPort implements LlmPort {
  readonly id = "capture";
  readonly capabilities: ModelCapabilities = {
    modelId: "capture/test",
    supportsStreaming: true,
    supportsTools: true,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  lastRequest: ModelRequest | undefined;

  async *complete(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.lastRequest = request;
    yield { type: "content_delta", content: "ok" };
    yield { type: "completed", finishReason: "stop" };
  }
}

describe("completeViaLlmPort", () => {
  it("falls back to reasoning_delta when content is empty", async () => {
    const port = completeViaLlmPort(new ReasoningOnlyLlmPort(), {
      toolDefinitions: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    const response = await port.complete({
      messages: [{ role: "user", content: "explain this project" }],
      tools: ["read_file"],
    });

    expect(response.text).toBe("Mitii is an agent runtime.");
    expect(response.reasonCodes).toContain("runtime_model_via_llm_port");
    expect(response.reasonCodes).toContain("runtime_model_reasoning_as_answer");
  });

  it("forwards onEvent stream deltas and returns usage", async () => {
    class StreamingLlmPort implements LlmPort {
      readonly id = "stream";
      readonly capabilities: ModelCapabilities = {
        modelId: "stream/test",
        supportsStreaming: true,
        supportsTools: true,
        supportsParallelToolCalls: false,
        supportsVision: false,
        supportsStructuredOutput: false,
        supportsReasoning: true,
        supportsPromptCaching: false,
        supportsEmbeddings: false,
        contextWindowTokens: 8_192,
        maximumOutputTokens: 1_000,
      };

      async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
        yield { type: "reasoning_delta", reasoning: "plan " };
        yield { type: "reasoning_delta", reasoning: "steps" };
        yield { type: "content_delta", content: "Hello " };
        yield { type: "content_delta", content: "world" };
        yield {
          type: "usage",
          usage: { inputTokens: 11, outputTokens: 7 },
        };
        yield {
          type: "completed",
          finishReason: "stop",
          usage: { inputTokens: 11, outputTokens: 7 },
        };
      }
    }

    const seen: string[] = [];
    const port = completeViaLlmPort(new StreamingLlmPort());
    const response = await port.complete(
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      },
      {
        onEvent: (event) => {
          if (event.type === "reasoning_delta") seen.push(`r:${event.reasoning}`);
          if (event.type === "content_delta") seen.push(`c:${event.content}`);
          if (event.type === "usage") {
            seen.push(`u:${event.usage.inputTokens}/${event.usage.outputTokens}`);
          }
        },
      },
    );

    expect(seen).toEqual([
      "r:plan ",
      "r:steps",
      "c:Hello ",
      "c:world",
      "u:11/7",
    ]);
    expect(response.text).toBe("Hello world");
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(response.finishReason).toBe("stop");
  });

  it("forwards assistant toolCalls into the ModelRequest", async () => {
    const llm = new CaptureRequestLlmPort();
    const port = completeViaLlmPort(llm);

    await port.complete({
      messages: [
        { role: "user", content: "list root" },
        {
          role: "assistant",
          content: "Calling tools: list_directory",
          toolCalls: [
            {
              callId: "c1",
              toolId: "list_directory",
              args: { path: "." },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "c1",
          content: '{"entries":["README.md"]}',
        },
      ],
      tools: ["list_directory"],
    });

    const assistant = llm.lastRequest?.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.toolCalls).toEqual([
      {
        id: "c1",
        name: "list_directory",
        arguments: JSON.stringify({ path: "." }),
      },
    ]);
  });
});
