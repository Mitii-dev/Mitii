import { modelEventSchema } from "../../model-gateway";
import type { LlmPort, ModelRequest } from "../../model-gateway";

export async function collectCompletionText(params: {
  llm: LlmPort;
  request: ModelRequest;
}): Promise<string> {
  let content = "";
  let reasoning = "";

  for await (const rawEvent of params.llm.complete(params.request)) {
    const event = modelEventSchema.parse(rawEvent);

    if (event.type === "failed" || event.type === "cancelled") {
      throw new Error(event.error.message);
    }
    if (event.type === "content_delta") {
      content += event.content;
    }
    if (event.type === "reasoning_delta") {
      reasoning += event.reasoning;
    }
  }

  const text = content.trim() || reasoning.trim();
  if (!text) {
    throw new Error("model_returned_empty_text");
  }
  return text;
}

export function parseLastJsonObject(text: string): unknown {
  const objects = extractJsonObjects(text);
  let lastError: unknown;

  for (let index = objects.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(objects[index]!);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractJsonObjects(response: string): string[] {
  const text = response.trim();
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (character !== "}") {
      continue;
    }
    depth -= 1;
    if (depth === 0 && start >= 0) {
      objects.push(text.slice(start, index + 1));
      start = -1;
    }
    if (depth < 0) {
      break;
    }
  }

  if (objects.length === 0) {
    throw new Error("model_returned_no_json_object");
  }
  return objects;
}
