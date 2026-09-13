# `@mitii/search-kit`

Host-neutral **web retrieval kit** for Mitii: pluggable search providers,
site-aware content resolvers, and URL safety.

This package has **no dependency** on `@mitii/v8`, `@mitii/sdk`, or apps.
Hosts adapt it onto V8 `SearchPort` / `NetworkPort`. A future Mitii MCP can
wrap the same kit without pulling the agent runtime.

```text
apps/cli | apps/vscode | (future MCP)
        |
        v
  @mitii/host  --------+--> @mitii/search-kit
        |              |
        v              |
  @mitii/sdk           |
        |              |
        v              |
  @mitii/v8  (SearchPort / NetworkPort contracts)
```

Forbidden: `search-kit → v8 | sdk | host | apps`.

## Install

```bash
pnpm add @mitii/search-kit
```

Requires **Node.js 20+**. Depends only on `zod`. License: **AGPL-3.0-or-later**.

## Intent

Coding agents need **evidence**, not engine sprawl:

1. **Search** — ordered provider fallback (SearXNG → Brave → Tavily)
2. **Fetch** — Stack Overflow answers, GitHub issue threads, Wikipedia,
   arXiv abstracts, markdown probes, then HTML readability
3. **Safety** — http(s) only, private-host blocking for content URLs,
   timeouts, byte/char caps, secret redaction in errors

Mitii keeps the model-facing tools small (`web_search`, `fetch_url`).
Richness lives behind host ports that call this kit.

## Quick use

```ts
import {
  createOptionalSearchProvider,
  createContentResolverChain,
  resolveSearchKitConfig,
} from '@mitii/search-kit';

const search = createOptionalSearchProvider({
  env: process.env,
  // apiKey: secretFromHost, // optional Brave override
});

if (search) {
  const hits = await search.search({
    query: 'playwright Target closed CI',
    maxResults: 5,
  });
}

const content = createContentResolverChain({
  config: resolveSearchKitConfig({ env: process.env }),
});
const page = await content.resolve({
  url: 'https://stackoverflow.com/questions/12345/example',
});
// page.body is LLM-oriented Markdown (question + answers)
```

## Configuration

| Variable | Purpose |
|---|---|
| `MITII_SEARCH_PROVIDERS` | Ordered list: `searxng,brave,tavily` |
| `SEARXNG_BASE_URL` / `MITII_SEARXNG_URL` | Self-hosted SearXNG base |
| `BRAVE_API_KEY` / `MITII_SEARCH_API_KEY` | Brave Search |
| `TAVILY_API_KEY` | Tavily Search |
| `GITHUB_TOKEN` | Higher GitHub API limits (issues) |
| `STACKEXCHANGE_KEY` | Optional Stack Exchange quota key |
| `MITII_MARKDOWN_ACCEPT_PROBE=1` | Probe `Accept: text/markdown` |
| `MITII_MARKDOWN_SUFFIX_HOSTS` | CSV hosts that serve `{path}.md` |

Default provider order when unset: **SearXNG (if URL) → Brave (if key) → Tavily (if key)**.

If nothing is configured, `createOptionalSearchProvider` returns `undefined`
so hosts can omit `SearchPort` and hide `web_search` honestly.

## Source layout

```text
src/
  index.ts           # public barrel
  types.ts           # Zod contracts
  safety/            # URL checks + limits
  http/              # bounded GET helper
  providers/         # brave | searxng | tavily | chain | config
  content/           # site resolvers + HTML fallback
```

Prefer importing from `@mitii/search-kit`. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Testing

```bash
pnpm --filter @mitii/search-kit test
pnpm --filter @mitii/search-kit typecheck
pnpm --filter @mitii/search-kit build
```

Tests use mocked `fetch` — no live network required.

## Non-goals (Phase 1–2)

- Browser / Playwright scraping
- Regional HTML engine farms (Baidu, Sogou, …)
- Academic multi-source paper download (use a dedicated MCP later)
- Changing V8 tool names or grant policy

## License

AGPL-3.0-or-later
