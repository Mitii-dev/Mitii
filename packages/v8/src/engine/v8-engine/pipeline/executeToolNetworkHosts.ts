/**
 * Web-search host extraction / package-registry host inference for grant widen.
 */
/** Extract public hosts from a successful web_search tool output (cap 16). */
export function extractHostsFromWebSearchOutput(output: unknown): string[] {
  if (!output || typeof output !== "object") {
    return [];
  }
  const record = output as { results?: unknown; query?: unknown };
  const results = record.results;
  const hosts = new Set<string>();
  if (Array.isArray(results)) {
    for (const hit of results) {
      if (!hit || typeof hit !== "object") continue;
      const url = (hit as { url?: unknown }).url;
      if (typeof url !== "string" || url.trim().length === 0) continue;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
        const host = parsed.hostname.toLowerCase();
        if (
          !host ||
          host === "localhost" ||
          host.endsWith(".local") ||
          host === "127.0.0.1" ||
          host === "::1"
        ) {
          continue;
        }
        hosts.add(host);
      } catch {
        continue;
      }
      if (hosts.size >= 12) break;
    }
  }

  const query = typeof record.query === "string" ? record.query : "";
  for (const host of inferPackageRegistryHostsFromQuery(query)) {
    hosts.add(host);
  }
  for (const host of expandRelatedNetworkHosts([...hosts])) {
    hosts.add(host);
  }
  return [...hosts].slice(0, 16);
}

/** Admit canonical package registries when search results already touch that ecosystem. */
export function expandRelatedNetworkHosts(hosts: readonly string[]): string[] {
  const set = new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  const extra: string[] = [];
  const touches = (...needles: string[]) =>
    [...set].some(
      (host) =>
        needles.some((needle) => host === needle || host.endsWith(`.${needle}`)),
    );

  if (touches("npmjs.com", "npmjs.org")) {
    extra.push("registry.npmjs.org", "www.npmjs.com", "npmjs.com");
  }
  if (touches("pypi.org", "pythonhosted.org")) {
    extra.push("pypi.org", "files.pythonhosted.org");
  }
  if (touches("crates.io", "docs.rs")) {
    extra.push("crates.io", "static.crates.io", "docs.rs");
  }
  if (touches("proxy.golang.org", "pkg.go.dev", "sum.golang.org")) {
    extra.push("proxy.golang.org", "pkg.go.dev", "sum.golang.org");
  }
  return extra.filter((host) => !set.has(host));
}

/**
 * When the search query looks like an npm/PyPI/crates package lookup, admit
 * the matching registry so follow-up fetch_url can hit the API, not only HTML
 * result pages (e.g. Snyk / GitHub) from the first hit list.
 */
export function inferPackageRegistryHostsFromQuery(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const hosts: string[] = [];
  if (
    /\bnpm\b/i.test(q) ||
    /(?:^|[\s"`'])@[a-z0-9][\w.-]*\/[\w.-]+/i.test(q) ||
    /\b(?:package\.json|node_modules|npmjs)\b/i.test(q)
  ) {
    hosts.push("registry.npmjs.org", "www.npmjs.com", "npmjs.com");
  }
  if (/\b(?:pypi|pip install|pyproject\.toml|requirements\.txt)\b/i.test(q)) {
    hosts.push("pypi.org", "files.pythonhosted.org");
  }
  if (/\b(?:crates\.io|cargo add|Cargo\.toml)\b/i.test(q)) {
    hosts.push("crates.io", "static.crates.io", "docs.rs");
  }
  if (/\b(?:pkg\.go\.dev|go get|go\.mod)\b/i.test(q)) {
    hosts.push("proxy.golang.org", "pkg.go.dev", "sum.golang.org");
  }
  return hosts;
}

