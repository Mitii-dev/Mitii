import { httpGet } from '../http/httpGet.js';
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

export interface StackExchangeResolverOptions {
  apiKey?: string;
  fetchImpl?: FetchImpl;
}

const QUESTION_RE = /\/(?:questions|q)\/(\d+)(?:\/|$)/i;
const ANSWER_RE = /\/a\/(\d+)(?:\/|$)/i;

export function parseStackExchangeUrl(
  url: string,
): { site: string; questionId?: number; answerId?: number } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = (parsed.hostname || '').toLowerCase();
  const site = deriveSite(host);
  if (!site) return undefined;

  const path = parsed.pathname || '';
  const q = QUESTION_RE.exec(path);
  if (q) return { site, questionId: Number(q[1]) };
  const a = ANSWER_RE.exec(path);
  if (a) return { site, answerId: Number(a[1]) };
  return undefined;
}

function deriveSite(host: string): string | undefined {
  if (host === 'meta.stackexchange.com') return 'meta';
  if (host.startsWith('meta.') && host.endsWith('.com')) {
    return host.slice(0, -'.com'.length);
  }
  if (host.endsWith('.stackexchange.com')) {
    return host.slice(0, -'.stackexchange.com'.length).split('.')[0];
  }
  const known: Record<string, string> = {
    'stackoverflow.com': 'stackoverflow',
    'www.stackoverflow.com': 'stackoverflow',
    'superuser.com': 'superuser',
    'serverfault.com': 'serverfault',
    'askubuntu.com': 'askubuntu',
    'stackapps.com': 'stackapps',
    'mathoverflow.net': 'mathoverflow',
  };
  return known[host];
}

/** Stack Exchange / Stack Overflow → structured Markdown via public API. */
export class StackExchangeContentResolver implements ContentResolver {
  readonly id = 'stackexchange';

  constructor(private readonly options: StackExchangeResolverOptions = {}) {}

  canHandle(url: string): boolean {
    return parseStackExchangeUrl(url) !== undefined;
  }

  async resolve(request: ContentResolveRequest): Promise<ContentResolveResult> {
    const req = normalizeContentRequest(request);
    const target = parseStackExchangeUrl(req.url);
    if (!target) throw new Error('Not a Stack Exchange URL.');

    let questionId = target.questionId;
    if (!questionId && target.answerId) {
      questionId = await this.lookupQuestionId(
        target.site,
        target.answerId,
        req,
      );
    }
    if (!questionId) {
      throw new Error('Could not resolve Stack Exchange question id.');
    }

    const api = new URL(
      `https://api.stackexchange.com/2.3/questions/${questionId}`,
    );
    api.searchParams.set('site', target.site);
    api.searchParams.set('filter', 'withbody');
    if (this.options.apiKey) api.searchParams.set('key', this.options.apiKey);

    const questionRes = await httpGet({
      url: api.toString(),
      headers: { Accept: 'application/json' },
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'Stack Exchange API',
    });
    if (questionRes.status < 200 || questionRes.status >= 300) {
      throw new Error(`Stack Exchange API HTTP ${questionRes.status}`);
    }

    const qPayload = JSON.parse(questionRes.body) as {
      items?: Array<Record<string, unknown>>;
    };
    const question = qPayload.items?.[0];
    if (!question) throw new Error('Stack Exchange question not found.');

    const answersApi = new URL(
      `https://api.stackexchange.com/2.3/questions/${questionId}/answers`,
    );
    answersApi.searchParams.set('site', target.site);
    answersApi.searchParams.set('filter', 'withbody');
    answersApi.searchParams.set('order', 'desc');
    answersApi.searchParams.set('sort', 'votes');
    answersApi.searchParams.set('pagesize', '5');
    if (this.options.apiKey) {
      answersApi.searchParams.set('key', this.options.apiKey);
    }

    const answersRes = await httpGet({
      url: answersApi.toString(),
      headers: { Accept: 'application/json' },
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'Stack Exchange answers API',
    });

    const answersPayload =
      answersRes.status >= 200 && answersRes.status < 300
        ? (JSON.parse(answersRes.body) as {
            items?: Array<Record<string, unknown>>;
          })
        : { items: [] };

    const title = String(question.title ?? 'Question');
    const qBody = stripHtmlToText(String(question.body ?? ''));
    const score = Number(question.score ?? 0);
    const link = String(question.link ?? req.url);

    const lines: string[] = [
      `# ${title}`,
      '',
      `Source: ${link}`,
      `Score: ${score} · Site: ${target.site}`,
      '',
      '## Question',
      '',
      qBody,
      '',
      '## Answers',
      '',
    ];

    for (const answer of answersPayload.items ?? []) {
      const aScore = Number(answer.score ?? 0);
      const accepted = answer.is_accepted === true ? ' (accepted)' : '';
      const aBody = stripHtmlToText(String(answer.body ?? ''));
      lines.push(`### Answer · score ${aScore}${accepted}`, '', aBody, '');
    }

    if ((answersPayload.items ?? []).length === 0) {
      lines.push('_No answers returned._', '');
    }

    return finishMarkdown({
      url: req.url,
      status: 200,
      body: lines.join('\n'),
      resolver: this.id,
    });
  }

  private async lookupQuestionId(
    site: string,
    answerId: number,
    req: ContentResolveRequest & { timeoutMs: number; maxBodyBytes: number },
  ): Promise<number | undefined> {
    const api = new URL(`https://api.stackexchange.com/2.3/answers/${answerId}`);
    api.searchParams.set('site', site);
    if (this.options.apiKey) api.searchParams.set('key', this.options.apiKey);
    const res = await httpGet({
      url: api.toString(),
      headers: { Accept: 'application/json' },
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'Stack Exchange answer lookup',
    });
    if (res.status < 200 || res.status >= 300) return undefined;
    const payload = JSON.parse(res.body) as {
      items?: Array<{ question_id?: number }>;
    };
    return payload.items?.[0]?.question_id;
  }
}
