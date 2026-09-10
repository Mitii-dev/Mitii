import {
  DEFAULT_CONTENT_TIMEOUT_MS,
  DEFAULT_MAX_CONTENT_BYTES,
  DEFAULT_MAX_MARKDOWN_CHARS,
  truncateText,
} from '../safety/limits.js';
import type { ContentResolveRequest, ContentResolveResult } from '../types.js';

export function normalizeContentRequest(
  request: ContentResolveRequest,
): Required<
  Pick<ContentResolveRequest, 'timeoutMs' | 'maxBodyBytes'>
> &
  ContentResolveRequest {
  return {
    ...request,
    timeoutMs: request.timeoutMs ?? DEFAULT_CONTENT_TIMEOUT_MS,
    maxBodyBytes: request.maxBodyBytes ?? DEFAULT_MAX_CONTENT_BYTES,
  };
}

export function finishMarkdown(params: {
  url: string;
  status: number;
  body: string;
  resolver: string;
  contentType?: string;
}): ContentResolveResult {
  const capped = truncateText(params.body.trim(), DEFAULT_MAX_MARKDOWN_CHARS);
  return {
    url: params.url,
    status: params.status,
    body: capped.text,
    contentType: params.contentType ?? 'text/markdown',
    resolver: params.resolver,
    truncated: capped.truncated,
  };
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
