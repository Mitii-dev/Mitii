export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parse a standard SSE stream into event/data pairs.
 * Used by Anthropic Messages and Gemini streamGenerateContent.
 */
export async function* iterateSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  const flush = (): SseEvent | undefined => {
    if (dataLines.length === 0 && !eventName) {
      return undefined;
    }
    const item: SseEvent = {
      event: eventName || "message",
      data: dataLines.join("\n"),
    };
    eventName = "";
    dataLines = [];
    return item;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          const item = flush();
          if (item) {
            yield item;
          }
          continue;
        }

        if (line.startsWith(":")) {
          continue;
        }

        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }
    }

    if (buffer.trim()) {
      const line = buffer;
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    const item = flush();
    if (item) {
      yield item;
    }
  } finally {
    reader.releaseLock();
  }
}
