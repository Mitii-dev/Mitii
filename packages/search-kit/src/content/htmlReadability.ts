import { httpGet } from '../http/httpGet.js';
import { assertPublicHttpUrl } from '../safety/urlSafety.js';
import type {
  ContentResolveRequest,
  ContentResolver,
  ContentResolveResult,
  FetchImpl,
} from '../types.js';
import {
  finishMarkdown,
  normalizeContentRequest,
  stripHtmlToText,
} from './shared.js';

export interface HtmlReadabilityResolverOptions {
  fetchImpl?: FetchImpl;
}

/**
 * Generic HTML → readable text fallback (no browser).
 * Prefer site-specific resolvers and markdown probes first.
 */
export class HtmlReadabilityContentResolver implements ContentResolver {
  readonly id = 'html_readability';

  constructor(private readonly options: HtmlReadabilityResolverOptions = {}) {}

  canHandle(url: string): boolean {
    try {
      assertPublicHttpUrl(url, 'HTML fetch URL');
      return true;
    } catch {
      return false;
    }
  }

  async resolve(request: ContentResolveRequest): Promise<ContentResolveResult> {
    const req = normalizeContentRequest(request);
    assertPublicHttpUrl(req.url, 'HTML fetch URL');

    const res = await httpGet({
      url: req.url,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'mitii-search-kit',
      },
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'HTML page',
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTML fetch HTTP ${res.status}`);
    }

    const contentType = res.headers['content-type'] ?? '';
    let body: string;
    if (
      contentType.includes('text/plain') ||
      contentType.includes('text/markdown') ||
      contentType.includes('application/json')
    ) {
      body = res.body;
    } else {
      body = extractMainText(res.body);
    }

    const title = extractTitle(res.body) ?? req.url;
    const markdown = [`# ${title}`, '', `Source: ${req.url}`, '', body, ''].join(
      '\n',
    );

    return finishMarkdown({
      url: req.url,
      status: res.status,
      body: markdown,
      resolver: this.id,
      contentType: contentType || 'text/html',
    });
  }
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return undefined;
  return stripHtmlToText(match[1]!).slice(0, 300) || undefined;
}

function extractMainText(html: string): string {
  // Prefer <article> / <main> when present; otherwise strip full document.
  const article =
    /<article[\s\S]*?>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<main[\s\S]*?>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    html;
  const withoutChrome = article
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return stripHtmlToText(withoutChrome);
}
