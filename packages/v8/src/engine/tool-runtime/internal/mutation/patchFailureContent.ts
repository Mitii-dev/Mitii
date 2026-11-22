import { isPatchCurrentContentReason } from "../../constants";
import { MutationError } from "./types";

const PATCH_CONFLICT_CONTENT_CHARS = 16_000;

/** Attach clipped current file content to patch-conflict errors for model repair. */
export function attachPatchFailureContent(
  error: unknown,
  path: string,
  currentContent: string | undefined,
): unknown {
  if (
    !(error instanceof MutationError) ||
    !isPatchCurrentContentReason(error.reasonCode)
  ) {
    return error;
  }
  if (currentContent === undefined) {
    return error;
  }
  const clipped =
    currentContent.length > PATCH_CONFLICT_CONTENT_CHARS
      ? `${currentContent.slice(0, PATCH_CONFLICT_CONTENT_CHARS)}\n…[truncated]`
      : currentContent;
  return new MutationError(error.reasonCode, error.message, {
    ...error.details,
    path,
    currentContent: clipped,
  });
}
