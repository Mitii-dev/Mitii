import {
  REQUEST_ENVELOPE_LIMITS,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "../request-envelope/constants";
import type { RequestImageAttachment } from "../request-envelope/types";

const SUPPORTED = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES);

export interface AttachmentNormalizeResult {
  attachments: RequestImageAttachment[];
  warnings: string[];
}

/**
 * Normalize and bound image attachments at intake.
 * Rejects unsupported mime types and oversize payloads via drop+warning
 * (zod still enforces hard caps on the final envelope).
 */
export function normalizeAttachments(
  attachments: readonly RequestImageAttachment[] | undefined,
): AttachmentNormalizeResult {
  if (!attachments || attachments.length === 0) {
    return { attachments: [], warnings: [] };
  }

  const warnings: string[] = [];
  const kept: RequestImageAttachment[] = [];

  for (const attachment of attachments) {
    if (kept.length >= REQUEST_ENVELOPE_LIMITS.MAXIMUM_ATTACHMENTS) {
      warnings.push("attachment_dropped:max_count");
      break;
    }

    const mimeType = attachment.mimeType.trim().toLowerCase();
    if (!SUPPORTED.has(mimeType)) {
      warnings.push(`attachment_dropped:unsupported_mime:${mimeType}`);
      continue;
    }

    const data = attachment.data.trim();
    if (!data) {
      warnings.push("attachment_dropped:empty_data");
      continue;
    }

    if (data.length > REQUEST_ENVELOPE_LIMITS.MAXIMUM_ATTACHMENT_DATA_CHARACTERS) {
      warnings.push("attachment_dropped:oversize");
      continue;
    }

    const name = attachment.name?.trim();
    kept.push({
      mimeType: mimeType as RequestImageAttachment["mimeType"],
      data,
      ...(name ? { name: name.slice(0, REQUEST_ENVELOPE_LIMITS.MAXIMUM_ATTACHMENT_NAME_CHARACTERS) } : {}),
    });
  }

  return { attachments: kept, warnings };
}
