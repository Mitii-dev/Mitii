import { httpGet } from '../http/httpGet.js';
import { assertPublicHttpUrl } from '../safety/urlSafety.js';
import type {
  ContentResolveRequest,
  ContentResolver,
  ContentResolveResult,
  FetchImpl,
} from '../types.js';
import { finishMarkdown, normalizeContentRequest } from './shared.js';

export interface MarkdownProbeResolverOptions {
  fetchImpl?: FetchImpl;
  /** When true, try Accept: text/markdown on every URL. */
  acceptProbe?: boolean;
  /** Hosts that serve `{path}.md` (e.g. docs sites). */
  suffixHosts?: readonly string[];
}

function hostMatches(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase().trim();
    if (!p) return false;
    if (p.includes('/')) {
      // host/path-prefix — only host part used for canHandle
      return host === p.split('/')[0] || host.endsWith(`.${p.split('/')[0]}`);
    }
    return host === p || host.endsWith(`.${p}`);
  });
}

function looksLikeMarkdown(body: string, contentType: string | undefined): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/markdown') || ct.includes('text/x-markdown')) {
    return body.trim().length >= 64;
  }
  // Accept-probe sometimes returns HTML; reject obvious HTML shells.
  const trimmed = body.trim();
  if (trimmed.length < 64) return false;
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return false;
  }
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(trimmed) || trimmed.includes('\n');
}

/**
 * Cheap markdown fast-path before generic HTML extraction.
 * Opt-in Accept probe; optional `{path}.md` suffix hosts.
 */
export class MarkdownProbeContentResolver implements ContentResolver {
  readonly id = 'markdown_probe';

  constructor(private readonly options: MarkdownProbeResolverOptions = {}) {}

  canHandle(url: string): boolean {
    try {
      const parsed = assertPublicHttpUrl(url, 'Markdown probe URL');
      if (this.options.acceptProbe) return true;
      const hosts = this.options.suffixHosts ?? [];
      return hosts.length > 0 && hostMatches(parsed.hostname, hosts);
    } catch {
      return false;
    }
  }

  async resolve(request: ContentResolveRequest): Promise<ContentResolveResult> {
    const req = normalizeContentRequest(request);
    const parsed = assertPublicHttpUrl(req.url, 'Markdown probe URL');
    const hosts = this.options.suffixHosts ?? [];

    if (hosts.length > 0 && hostMatches(parsed.hostname, hosts)) {
      const mdUrl = toMarkdownSuffixUrl(parsed);
      const suffixHit = await this.tryFetchMarkdown(mdUrl, req);
      if (suffixHit) return suffixHit;
    }

    if (this.options.acceptProbe) {
      const acceptHit = await this.tryFetchMarkdown(parsed.toString(), req, {
        Accept: 'text/markdown',
      });
      if (acceptHit) return acceptHit;
    }

    throw new Error('Markdown probe did not find markdown content.');
  }

  private async tryFetchMarkdown(
    url: string,
    req: ContentResolveRequest & { timeoutMs: number; maxBodyBytes: number },
    extraHeaders?: Record<string, string>,
  ): Promise<ContentResolveResult | undefined> {
    try {
      const res = await httpGet({
        url,
        headers: {
          'User-Agent': 'mitii-search-kit',
          ...extraHeaders,
        },
        timeoutMs: req.timeoutMs,
        maxBodyBytes: req.maxBodyBytes,
        signal: req.signal,
        fetchImpl: this.options.fetchImpl,
        label: 'Markdown probe',
      });
      if (res.status < 200 || res.status >= 300) return undefined;
      const contentType = res.headers['content-type'];
      if (!looksLikeMarkdown(res.body, contentType)) return undefined;
      return finishMarkdown({
        url: req.url,
        status: res.status,
        body: res.body,
        resolver: this.id,
        contentType: contentType ?? 'text/markdown',
      });
    } catch {
      return undefined;
    }
  }
}

function toMarkdownSuffixUrl(parsed: URL): string {
  const path = parsed.pathname.endsWith('.md')
    ? parsed.pathname
    : `${parsed.pathname.replace(/\/$/, '')}.md`;
  return `${parsed.origin}${path}${parsed.search}`;
}
