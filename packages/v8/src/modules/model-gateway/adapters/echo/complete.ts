import type {
  ModelCallContext,
  ModelEvent,
  ModelRequest,
} from "../../contracts/contracts";

/** Port method: `LlmPort.complete` (echo). */
export async function* echoComplete(params: {
  request: ModelRequest;
  context?: ModelCallContext;
  chunkCharacters: number;
}): AsyncIterable<ModelEvent> {
  if (params.context?.abortSignal?.aborted) {
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

  const lastUser = [...params.request.messages]
    .reverse()
    .find((message) => message.role === "user");

  const response = `Echo: ${lastUser?.content ?? ""}`;

  for (
    let index = 0;
    index < response.length;
    index += params.chunkCharacters
  ) {
    if (params.context?.abortSignal?.aborted) {
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
      content: response.slice(index, index + params.chunkCharacters),
    };
  }

  yield {
    type: "completed",
    finishReason: "stop",
  };
}
