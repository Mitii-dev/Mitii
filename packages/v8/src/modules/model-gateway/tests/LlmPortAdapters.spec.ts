import { describe, expect, it } from "vitest";

import {
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  modelEventSchema,
  modelRequestSchema,
  MODEL_PROVIDER_SUPPORT,
} from "../index";
import type { ModelEvent } from "../contracts/types";

async function collectContent(
  stream: AsyncIterable<ModelEvent>,
): Promise<string> {
  let content = "";

  for await (const event of stream) {
    if (event.type === "content_delta") {
      content += event.content;
    }
  }

  return content;
}

async function collectEvents(
  stream: AsyncIterable<ModelEvent>,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("LlmPort adapters", () => {
it("echo llm port streams the last user message", async () => {
  const port = new EchoLlmPort({ chunkCharacters: 8 });
  const content = await collectContent(
    port.complete({
      messages: [
        { role: "system", content: "You are a test." },
        { role: "user", content: "hello world" },
      ],
    }),
  );

  expect(content).toBe("Echo: hello world");
  expect(port.id).toBe("echo");
  expect(await port.countTokens!("abcd")).toBeGreaterThanOrEqual(1);
});

it("echo llm port cancels when abort signal is already aborted", async () => {
  const port = new EchoLlmPort();
  const controller = new AbortController();
  controller.abort();

  const events = await collectEvents(
    port.complete(
      { messages: [{ role: "user", content: "hi" }] },
      { abortSignal: controller.signal },
    ),
  );

  expect(events[0]?.type).toBe("cancelled");
  expect(modelEventSchema.safeParse(events[0]).success).toBe(true);
});

it("openai compatible port maps non-streaming responses", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "pong",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "lookup",
                    arguments: '{"q":"1"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  const port = new OpenAiCompatibleLlmPort({
    baseUrl: "https://example.test/v1",
    model: "test-model",
    apiKey: "secret",
    fetchImpl,
  });

  const events = await collectEvents(
    port.complete({
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      tools: [
        {
          name: "lookup",
          description: "Lookup a value",
          inputSchema: { type: "object" },
        },
      ],
      toolChoice: "auto",
    }),
  );

  expect(events[0]?.type).toBe("content_delta");
  expect(events[0]?.type === "content_delta" && events[0].content).toBe("pong");
  expect(events[1]?.type).toBe("tool_call_delta");
  expect(
    events[1]?.type === "tool_call_delta" && events[1].toolCalls[0]?.id,
  ).toBe("call-1");
  const completed = events.find((event) => event.type === "completed");
  expect(completed?.type === "completed" && completed.finishReason).toBe("tool_calls");
  expect(completed?.type === "completed" && completed.usage?.totalTokens).toBe(5);
});

it("openai compatible port maps prompt cache hit and miss tokens", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 8,
          total_tokens: 108,
          prompt_cache_hit_tokens: 70,
          prompt_cache_miss_tokens: 30,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  const port = new OpenAiCompatibleLlmPort({
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "secret",
    fetchImpl,
    capabilities: { supportsPromptCaching: true },
  });

  const events = await collectEvents(
    port.complete({
      messages: [{ role: "user", content: "ping" }],
      stream: false,
    }),
  );
  const completed = events.find((event) => event.type === "completed");
  expect(completed?.type === "completed" && completed.usage?.cacheHitTokens).toBe(70);
  expect(completed?.type === "completed" && completed.usage?.cacheMissTokens).toBe(30);
});

it("openai compatible downgrades forced tool choice and skips unsupported response_format", async () => {
  let body: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const port = new OpenAiCompatibleLlmPort({
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    apiKey: "secret",
    fetchImpl,
    capabilities: {
      supportsTools: true,
      supportsForcedToolChoice: false,
      supportsStructuredOutput: false,
    },
  });

  await collectEvents(
    port.complete({
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      tools: [
        {
          name: "read_file",
          description: "Read",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
      toolChoice: "required",
      responseFormat: { type: "json_object" },
    }),
  );

  expect(body?.tool_choice).toBe("auto");
  expect(body?.response_format).toBeUndefined();
});

it("openai compatible port maps SSE streaming chunks", async () => {
  const payload = [
    'data: {"choices":[{"delta":{"content":"hel"}}]}',
    'data: {"choices":[{"delta":{"content":"lo"}}]}',
    "data: [DONE]",
    "",
  ].join("\n");

  const fetchImpl: typeof fetch = async () =>
    new Response(payload, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

  const port = new OpenAiCompatibleLlmPort({
    baseUrl: "https://example.test/v1",
    model: "stream-model",
    fetchImpl,
  });

  const content = await collectContent(
    port.complete({
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    }),
  );

  expect(content).toBe("hello");
});

it("openai compatible port derives output tokens from configured context", () => {
  const port = new OpenAiCompatibleLlmPort({
    baseUrl: "https://example.test/v1",
    model: "large-context-model",
    capabilities: {
      contextWindowTokens: 252_000,
    },
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });

  expect(port.capabilities.contextWindowTokens).toBe(252_000);
  expect(port.capabilities.maximumOutputTokens).toBe(63_000);
});

it("openai compatible port maps authentication failures", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("unauthorized", { status: 401 });

  const port = new OpenAiCompatibleLlmPort({
    baseUrl: "https://example.test/v1",
    model: "secure-model",
    apiKey: "bad",
    fetchImpl,
  });

  const events = await collectEvents(
    port.complete({
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    }),
  );

  expect(events[0]?.type).toBe("failed");
  expect(
    events[0]?.type === "failed" && events[0].error.code,
  ).toBe("authentication_failed");
  expect(
    events[0]?.type === "failed" && events[0].error.retryable,
  ).toBe(false);
});

it("openai compatible request bodies validate against modelRequestSchema", () => {
  expect(
    modelRequestSchema.safeParse({
      messages: [{ role: "user", content: "ok" }],
      toolChoice: "required",
    }).success,
  ).toBe(false);
});

it("provider support matrix lists only shipped adapters", () => {
  expect(MODEL_PROVIDER_SUPPORT.openai.status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT.ollama.status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT["openai-compatible"].status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT.openrouter.status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT.deepseek.status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT["lm-studio"].status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT["azure-openai"].status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT.anthropic.status).toBe("supported");
  expect(MODEL_PROVIDER_SUPPORT.gemini.status).toBe("supported");
  expect(modelEventSchema.safeParse({ type: "content_delta" }).success).toBe(false);
  expect(
    modelEventSchema.safeParse({
      type: "content_delta",
      content: "x",
    }).success,
  ).toBe(true);
});
});
