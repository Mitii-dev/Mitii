import { UNTRUSTED_CONTENT_INJECTION_PATTERNS } from "../policy";

const MITII_USER_MESSAGE_MARKER = "<<<MITII_USER_MESSAGE>>>";
const MITII_HOST_CONTEXT_MARKER = "<<<MITII_HOST_CONTEXT>>>";

export function wrapUntrustedRepositoryContent(params: {
  stateToken: string;
  body: string;
}): string {
  return [
    `<repository_context trust="untrusted_data" stateToken="${escapeAttr(params.stateToken)}">`,
    params.body,
    `</repository_context>`,
  ].join("\n");
}

export function wrapUntrustedFileBlock(params: {
  id: string;
  relativePath: string;
  content: string;
  selectionKey?: string;
  priority?: number;
  lineRanges?: readonly { startLine: number; endLine: number }[];
}): string {
  const rangeAttr =
    params.lineRanges && params.lineRanges.length > 0
      ? ` lines="${params.lineRanges
          .map((range) => `${range.startLine}-${range.endLine}`)
          .join(",")}"`
      : "";
  const selectionAttr = params.selectionKey
    ? ` selectionKey="${escapeAttr(params.selectionKey)}"`
    : "";
  const priorityAttr =
    params.priority !== undefined
      ? ` priority="${params.priority}"`
      : "";

  return [
    `<file id="${escapeAttr(params.id)}" path="${escapeAttr(params.relativePath)}"${selectionAttr}${priorityAttr}${rangeAttr}>`,
    params.content,
    `</file>`,
  ].join("\n");
}

export function wrapUserRequest(message: string): string {
  const split = splitUserAndHostContext(message);
  const parts = [
    `<user_request trust="instruction">`,
    split.userMessage,
    `</user_request>`,
  ];
  if (split.hostContext) {
    parts.push(
      `<host_context trust="untrusted_data">`,
      split.hostContext,
      `</host_context>`,
    );
  }
  return parts.join("\n");
}

function splitUserAndHostContext(message: string): {
  userMessage: string;
  hostContext?: string;
} {
  const text = message.trim();
  const userIdx = text.indexOf(MITII_USER_MESSAGE_MARKER);
  if (userIdx < 0) {
    return { userMessage: message };
  }

  const afterUserMarker = text
    .slice(userIdx + MITII_USER_MESSAGE_MARKER.length)
    .trimStart();
  const hostIdx = afterUserMarker.indexOf(MITII_HOST_CONTEXT_MARKER);
  if (hostIdx < 0) {
    return { userMessage: afterUserMarker.trim() || message };
  }

  const userMessage = afterUserMarker.slice(0, hostIdx).trim();
  const hostContext = afterUserMarker
    .slice(hostIdx + MITII_HOST_CONTEXT_MARKER.length)
    .trim();

  return {
    userMessage: userMessage || message,
    ...(hostContext ? { hostContext } : {}),
  };
}

export function countInjectionSignals(content: string): number {
  let count = 0;
  for (const pattern of UNTRUSTED_CONTENT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      count += 1;
    }
  }
  return count;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
