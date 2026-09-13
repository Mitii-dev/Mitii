import { httpGet } from '../http/httpGet.js';
import type {
  ContentResolveRequest,
  ContentResolver,
  ContentResolveResult,
  FetchImpl,
} from '../types.js';
import { finishMarkdown, normalizeContentRequest } from './shared.js';

export interface ArxivResolverOptions {
  fetchImpl?: FetchImpl;
}

const ARXIV_RE =
  /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/([0-9]+\.[0-9]+(?:v\d+)?)(?:\.pdf)?/i;

export function parseArxivUrl(url: string): { id: string } | undefined {
  const match = ARXIV_RE.exec(url.trim());
  if (!match) return undefined;
  return { id: match[1]! };
}

/** arXiv abstract via Atom API (no PDF download in Phase 1). */
export class ArxivContentResolver implements ContentResolver {
  readonly id = 'arxiv';

  constructor(private readonly options: ArxivResolverOptions = {}) {}

  canHandle(url: string): boolean {
    return parseArxivUrl(url) !== undefined;
  }

  async resolve(request: ContentResolveRequest): Promise<ContentResolveResult> {
    const req = normalizeContentRequest(request);
    const target = parseArxivUrl(req.url);
    if (!target) throw new Error('Not an arXiv URL.');

    const api = new URL('https://export.arxiv.org/api/query');
    api.searchParams.set('id_list', target.id);

    const res = await httpGet({
      url: api.toString(),
      headers: { Accept: 'application/atom+xml' },
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'arXiv API',
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`arXiv API HTTP ${res.status}`);
    }

    const xml = res.body;
    const title = textBetween(xml, '<title>', '</title>', 1) ?? target.id;
    const summary =
      textBetween(xml, '<summary>', '</summary>')?.trim() ??
      '_No abstract._';
    const published = textBetween(xml, '<published>', '</published>');
    const idUrl =
      textBetween(xml, '<id>', '</id>') ?? `https://arxiv.org/abs/${target.id}`;

    const body = [
      `# ${collapseWs(title)}`,
      '',
      `Source: ${idUrl}`,
      published ? `Published: ${published}` : undefined,
      '',
      '## Abstract',
      '',
      collapseWs(summary),
      '',
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    return finishMarkdown({
      url: req.url,
      status: 200,
      body,
      resolver: this.id,
    });
  }
}

function textBetween(
  source: string,
  start: string,
  end: string,
  skip = 0,
): string | undefined {
  let from = 0;
  for (let i = 0; i <= skip; i += 1) {
    const idx = source.indexOf(start, from);
    if (idx < 0) return undefined;
    from = idx + start.length;
  }
  const endIdx = source.indexOf(end, from);
  if (endIdx < 0) return undefined;
  return source.slice(from, endIdx);
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
