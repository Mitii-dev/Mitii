import {
  createContentResolverChain,
  createOptionalSearchProvider,
  resolveSearchKitConfig,
} from '@mitii/search-kit';

import {
  MEMORY_TOOL_DEFINITIONS,
  handleMemoryToolCall,
} from './memory/handleMemoryTool.js';
import { isMemoryToolsEnabled } from './memory/pathSafety.js';

const BASE_TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description:
      'Search the public web via configured Mitii search providers (Brave / SearXNG / Tavily).',
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
  {
    name: 'fetch_url',
    description:
      'Fetch and extract readable content from a public HTTP(S) URL via search-kit resolvers.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public http(s) URL' },
      },
      required: ['url'],
    },
  },
] as const;

/** Tool list — memory tools appear only when MITII_MCP_WEB_MEMORY is enabled. */
export function listToolDefinitions(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyArray<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  if (isMemoryToolsEnabled(env)) {
    return [...BASE_TOOL_DEFINITIONS, ...MEMORY_TOOL_DEFINITIONS];
  }
  return [...BASE_TOOL_DEFINITIONS];
}

/** @deprecated Prefer listToolDefinitions(); kept for callers that expect a const. */
export const TOOL_DEFINITIONS = BASE_TOOL_DEFINITIONS;

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const memory = await handleMemoryToolCall(name, args, env);
    if (memory) return memory;

    if (name === 'web_search') {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) {
        return textResult('query is required', true);
      }
      const maxResults =
        typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
          ? Math.max(1, Math.min(20, Math.floor(args.maxResults)))
          : 5;
      const provider = createOptionalSearchProvider({ env });
      if (!provider) {
        return textResult(
          'No search provider configured. Set BRAVE_API_KEY / TAVILY_API_KEY / SEARXNG_URL.',
          true,
        );
      }
      const result = await provider.search({ query, maxResults });
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === 'fetch_url') {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) {
        return textResult('url is required', true);
      }
      const config = resolveSearchKitConfig({ env });
      const chain = createContentResolverChain({ config });
      const resolved = await chain.resolve({ url });
      return textResult(JSON.stringify(resolved, null, 2));
    }

    return textResult(`Unknown tool: ${name}`, true);
  } catch (error) {
    return textResult(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
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
