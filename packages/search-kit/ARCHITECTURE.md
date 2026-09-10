# @mitii/search-kit — Architecture

Status: Phase 1–2 web retrieval kit (providers + content resolvers)  
Depends on: `zod`  
Must **not** depend on: `@mitii/v8`, `@mitii/sdk`, `@mitii/host`, apps

## Purpose

Own **vendor-agnostic web retrieval** so Mitii hosts (and a future MCP) can
inject search and content fetching without growing the agent engine.

V8 remains the authority for:

- tool grants (`web_search`, `fetch_url`)
- approvals, sanitization, output byte caps
- `SearchPort` / `NetworkPort` contracts

This package implements **how** search/fetch are fulfilled.

## Dependency graph

```text
apps/vscode --+
apps/cli -----+--> @mitii/host --> @mitii/search-kit
apps/daemon --|         |
              |         +--> adapts kit → V8 SearchPort / NetworkPort
              `--> @mitii/sdk --> @mitii/v8
```

Forbidden:

- `@mitii/search-kit` → v8 | sdk | host | apps
- `@mitii/v8` → search-kit
- `@mitii/sdk` → search-kit

## Module layout

```text
src/
  types.ts                 # public Zod schemas + provider/resolver interfaces
  safety/urlSafety.ts      # http(s) + private-host policy
  safety/limits.ts         # timeouts, caps
  http/httpGet.ts          # bounded GET + redirect + secret scrubbing
  providers/
    brave.ts | searxng.ts | tavily.ts
    chain.ts               # ordered fallback + partialFailures
    resolveConfig.ts       # env/host config → providers
  content/
    stackexchange.ts       # SO / SE API → Markdown
    githubIssue.ts         # Issues + comments → Markdown
    wikipedia.ts | arxiv.ts
    markdownProbe.ts       # Accept / .md fast path
    htmlReadability.ts     # generic HTML → text
    resolver.ts            # ordered ContentResolverChain
```

## Contracts

### SearchProvider

```ts
interface SearchProvider {
  readonly id: 'brave' | 'searxng' | 'tavily';
  search(request: {
    query: string;
    maxResults: number;
    signal?: AbortSignal;
  }): Promise<{
    query: string;
    results: Array<{ title; url; snippet; publishedAt?; source? }>;
    truncated: boolean;
    provider?: string;
    partialFailures?: Array<{ provider; message }>;
  }>;
}
```

Host mapping: `SearchPort.search` ← `SearchProvider.search` (drop kit-only
fields if the V8 schema rejects them, or pass through when compatible).

### ContentResolver

```ts
interface ContentResolver {
  readonly id: string;
  canHandle(url: string): boolean;
  resolve(request: {
    url: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBodyBytes?: number;
  }): Promise<{
    url: string;
    status: number;
    body: string;          // Markdown / plain text
    contentType?: string;
    resolver: string;
    truncated: boolean;
  }>;
}
```

Host mapping: wrap V8 `NetworkPort` so `fetch_url` / `fetch_docs` first try
the content chain, then fall back to raw HTTP.

## Safety defaults

| Control | Default |
|---|---|
| Schemes | `http:` / `https:` only |
| Content private hosts | Blocked |
| SearXNG base URL | Private/localhost **allowed** |
| Search timeout | 12s |
| Content timeout | 15s |
| Max content body | 512 KiB |
| Max Markdown chars | 48k |
| Provider chain length | ≤ 5 |
| Redirects | ≤ 3 |
| Errors | API keys / bearer tokens scrubbed |

## Enterprise checklist

- [x] Config via env + explicit host overrides (SecretStorage)
- [x] Honest “no provider” → `undefined` (hide tool)
- [x] Partial failure reporting on search chain
- [x] AbortSignal + timeouts
- [x] Deterministic Zod validation at config boundary
- [x] Unit tests with mocked fetch (no live network)
- [x] No browser dependency in Phase 1–2

## Evolution

| Phase | Scope |
|---|---|
| 1 | Brave + SearXNG + Tavily; SO/GH/Wiki/arXiv + HTML fallback |
| 2 | Extracted package + host wiring (this package) |
| 3 | Optional `@mitii/mcp-web` wrapping the same kit |
| later | Browser scrape MCP (not this package) |
