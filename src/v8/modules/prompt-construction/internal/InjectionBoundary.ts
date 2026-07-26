import { UNTRUSTED_CONTENT_INJECTION_PATTERNS } from "../policy";

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
  return [
    `<user_request trust="instruction">`,
    message,
    `</user_request>`,
  ].join("\n");
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
