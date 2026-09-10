import { httpGet } from '../http/httpGet.js';
import type {
  ContentResolveRequest,
  ContentResolver,
  ContentResolveResult,
  FetchImpl,
} from '../types.js';
import { finishMarkdown, normalizeContentRequest } from './shared.js';

export interface WikipediaResolverOptions {
  fetchImpl?: FetchImpl;
}

const WIKI_RE =
  /^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^?#]+)/i;

export function parseWikipediaUrl(
  url: string,
): { lang: string; title: string } | undefined {
  const match = WIKI_RE.exec(url.trim());
  if (!match) return undefined;
  return {
    lang: match[1]!.toLowerCase(),
    title: decodeURIComponent(match[2]!.replace(/_/g, ' ')),
  };
}

/** Wikipedia article extract via MediaWiki Action API. */
export class WikipediaContentResolver implements ContentResolver {
  readonly id = 'wikipedia';

  constructor(private readonly options: WikipediaResolverOptions = {}) {}

  canHandle(url: string): boolean {
    return parseWikipediaUrl(url) !== undefined;
  }

  async resolve(request: ContentResolveRequest): Promise<ContentResolveResult> {
    const req = normalizeContentRequest(request);
    const target = parseWikipediaUrl(req.url);
    if (!target) throw new Error('Not a Wikipedia URL.');

    const api = new URL(`https://${target.lang}.wikipedia.org/w/api.php`);
    api.searchParams.set('action', 'query');
    api.searchParams.set('prop', 'extracts');
    api.searchParams.set('explaintext', '1');
    api.searchParams.set('exsectionformat', 'plain');
    api.searchParams.set('titles', target.title);
    api.searchParams.set('format', 'json');
    api.searchParams.set('formatversion', '2');

    const res = await httpGet({
      url: api.toString(),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'mitii-search-kit',
      },
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'Wikipedia API',
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Wikipedia API HTTP ${res.status}`);
    }

    const payload = JSON.parse(res.body) as {
      query?: { pages?: Array<{ title?: string; extract?: string; missing?: boolean }> };
    };
    const page = payload.query?.pages?.[0];
    if (!page || page.missing || !page.extract) {
      throw new Error('Wikipedia page not found or empty.');
    }

    const body = [
      `# ${page.title ?? target.title}`,
      '',
      `Source: ${req.url}`,
      '',
      page.extract.trim(),
      '',
    ].join('\n');

    return finishMarkdown({
      url: req.url,
      status: 200,
      body,
      resolver: this.id,
    });
  }
}
