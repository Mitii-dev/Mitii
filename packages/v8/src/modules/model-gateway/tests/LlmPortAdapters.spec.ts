import assert from "node:assert/strict";
import test from "node:test";

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

test("echo llm port streams the last user message", async () => {
  const port = new EchoLlmPort({ chunkCharacters: 8 });
  const content = await collectContent(
    port.complete({
      messages: [
        { role: "system", content: "You are a test." },
        { role: "user", content: "hello world" },
      ],
    }),
  );

  assert.equal(content, "Echo: hello world");
  assert.equal(port.id, "echo");
  assert.ok((await port.countTokens!("abcd")) >= 1);
});

test("echo llm port cancels when abort signal is already aborted", async () => {
  const port = new EchoLlmPort();
  const controller = new AbortController();
  controller.abort();

  const events = await collectEvents(
    port.complete(
      { messages: [{ role: "user", content: "hi" }] },
      { abortSignal: controller.signal },
    ),
  );

  assert.equal(events[0]?.type, "cancelled");
  assert.equal(modelEventSchema.safeParse(events[0]).success, true);
});

test("openai compatible port maps non-streaming responses", async () => {
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

  assert.equal(events[0]?.type, "content_delta");
  assert.equal(events[0]?.type === "content_delta" && events[0].content, "pong");
  assert.equal(events[1]?.type, "tool_call_delta");
  assert.equal(
    events[1]?.type === "tool_call_delta" && events[1].toolCalls[0]?.id,
    "call-1",
  );
  const completed = events.find((event) => event.type === "completed");
  assert.equal(completed?.type === "completed" && completed.finishReason, "tool_calls");
  assert.equal(completed?.type === "completed" && completed.usage?.totalTokens, 5);
});

test("openai compatible port maps prompt cache hit and miss tokens", async () => {
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
  assert.equal(completed?.type === "completed" && completed.usage?.cacheHitTokens, 70);
  assert.equal(completed?.type === "completed" && completed.usage?.cacheMissTokens, 30);
});

test("openai compatible port maps SSE streaming chunks", async () => {
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

  assert.equal(content, "hello");
});

test("openai compatible port derives output tokens from configured context", () => {
  const port = new OpenAiCompatibleLlmPort({
    baseUrl: "https://example.test/v1",
    model: "large-context-model",
    capabilities: {
      contextWindowTokens: 252_000,
    },
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });

  assert.equal(port.capabilities.contextWindowTokens, 252_000);
  assert.equal(port.capabilities.maximumOutputTokens, 63_000);
});

test("openai compatible port maps authentication failures", async () => {
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

  assert.equal(events[0]?.type, "failed");
  assert.equal(
    events[0]?.type === "failed" && events[0].error.code,
    "authentication_failed",
  );
  assert.equal(
    events[0]?.type === "failed" && events[0].error.retryable,
    false,
  );
});

test("openai compatible request bodies validate against modelRequestSchema", () => {
  assert.equal(
    modelRequestSchema.safeParse({
      messages: [{ role: "user", content: "ok" }],
      toolChoice: "required",
    }).success,
    false,
  );
});

test("provider support matrix lists only shipped adapters", () => {
  assert.equal(MODEL_PROVIDER_SUPPORT.openai.status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT.ollama.status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT["openai-compatible"].status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT.openrouter.status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT.deepseek.status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT["lm-studio"].status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT["azure-openai"].status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT.anthropic.status, "supported");
  assert.equal(MODEL_PROVIDER_SUPPORT.gemini.status, "supported");
  assert.equal(modelEventSchema.safeParse({ type: "content_delta" }).success, false);
  assert.equal(
    modelEventSchema.safeParse({
      type: "content_delta",
      content: "x",
    }).success,
    true,
  );
});
