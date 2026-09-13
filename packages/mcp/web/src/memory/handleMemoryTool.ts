import { readFile } from 'node:fs/promises';

import { isMemoryToolsEnabled, resolveSafeFactsPath } from './pathSafety.js';
import { rankShareableFacts, softParseFactsEnvelope } from './softParseFacts.js';

export const MEMORY_TOOL_DEFINITIONS = [
  {
    name: 'memory_search',
    description:
      'Read-only search of shareable Mitii workspace memory facts (facts.json). Private facts are never returned. Disabled unless MITII_MCP_WEB_MEMORY=1.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: {
          type: 'number',
          description: 'Max hits (1-20)',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
] as const;

export async function handleMemoryToolCall(
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
  if (name !== 'memory_search') return null;

  if (!isMemoryToolsEnabled(env)) {
    return textResult(
      'memory_search is disabled. Set MITII_MCP_WEB_MEMORY=1 and MITII_WORKSPACE_ROOT to enable read-only shareable memory search.',
      true,
    );
  }

  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return textResult('query is required', true);
  }

  const maxResults =
    typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
      ? Math.max(1, Math.min(20, Math.floor(args.maxResults)))
      : 5;

  const workspaceRoot = (env.MITII_WORKSPACE_ROOT ?? '').trim();
  const safe = await resolveSafeFactsPath({
    workspaceRoot,
    relativeOrAbsolute: env.MITII_MEMORY_FACTS_PATH,
  });
  if (!safe.ok) {
    return textResult(safe.error, true);
  }

  let raw: string;
  try {
    raw = await readFile(safe.path, 'utf8');
  } catch (error) {
    return textResult(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }

  const facts = softParseFactsEnvelope(raw);
  const hits = rankShareableFacts(facts, query, maxResults);
  return textResult(
    JSON.stringify(
      {
        query,
        hitCount: hits.length,
        facts: hits.map((fact) => ({
          id: fact.id,
          title: fact.title,
          content: fact.content,
          tags: fact.tags,
          files: fact.files,
          type: fact.type,
          privacy: 'shareable',
        })),
      },
      null,
      2,
    ),
  );
}

function textResult(
  text: string,
  isError = false,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}
