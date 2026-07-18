import type { ArtifactClassification, ArtifactKind, ArtifactSignal } from '../types';

/**
 * Known file extensions only — a bare "\.[a-z0-9]+" alternative also matches
 * non-path tokens pasted from logs/stack traces (e.g. "json.success", "3.1s"),
 * which pollutes artifact detection with junk "unknown" candidates.
 */
const PATH_EXTENSIONS =
  'jsonl|json|md|mdx|rst|adoc|ya?ml|toml|ini|env|tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|kts|swift|rb|php|cs|cpp|cc|c|h|hpp|txt|csv|log|lock|sql|css|scss|less|html?|vue|svelte|sh|bash|zsh|graphql|proto';

const EXPLICIT_PATH_RE = new RegExp(
  String.raw`(?:^|[\s"'\`(])((?:[a-z]:[\\/]|\/|\.{0,2}[\\/])?[^\s"'\`()]+(?:\.(?:${PATH_EXTENSIONS})|[\\/]\.mitii[\\/]logs(?:[\\/][^\s"'\`()]+)?))(?=$|[\s"'\`),])`,
  'gi'
);

export function classifyArtifacts(message: string): ArtifactClassification {
  const normalized = message.trim();
  const artifacts: ArtifactSignal[] = [];
  const seen = new Set<string>();

  for (const match of normalized.matchAll(EXPLICIT_PATH_RE)) {
    const rawPath = match[1]?.replace(/[.,;:]+$/, '');
    if (!rawPath) continue;
    const path = rawPath.replace(/\\/g, '/');
    pushArtifact(artifacts, seen, {
      kind: classifyArtifactPath(path),
      path,
      source: 'explicit',
      confidence: 1,
    });
  }
  for (const match of normalized.matchAll(
    /(?:[a-z]:[\\/]|\/|\.{0,2}[\\/])?[^\s"'`()]*\.mitii[\\/]logs(?:[\\/][^\s"'`()]+)?/gi
  )) {
    const path = match[0].replace(/[.,;:]+$/, '').replace(/\\/g, '/');
    pushArtifact(artifacts, seen, {
      kind: 'log_directory',
      path,
      source: 'explicit',
      confidence: 1,
    });
  }

  if (artifacts.length === 0 && /\breadme\b/i.test(normalized)) {
    pushArtifact(artifacts, seen, {
      kind: 'readme',
      source: 'inferred',
      confidence: 0.85,
    });
  }
  if (artifacts.length === 0 && /\b(?:git|commit|branch|pull request|merge|rebase)\b/i.test(normalized)) {
    pushArtifact(artifacts, seen, {
      kind: 'git_repository',
      source: 'inferred',
      confidence: 0.75,
    });
  }
  if (artifacts.length === 0 && /\b(?:docs?|documentation|mdx|docusaurus)\b/i.test(normalized)) {
    pushArtifact(artifacts, seen, {
      kind: 'documentation',
      source: 'inferred',
      confidence: 0.7,
    });
  }

  return { artifacts };
}

export function classifyArtifactPath(path: string): ArtifactKind {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const basename = normalized.split('/').pop() ?? normalized;
  if (/(?:^|\/)\.mitii\/logs(?:\/|$)/.test(normalized)) return 'log_directory';
  if (/\.jsonl$/.test(normalized)) return 'jsonl_file';
  if (/^readme(?:\.[^.]+)?\.mdx?$/.test(basename)) return 'readme';
  if (/(?:^|\/)(?:test|tests|__tests__)\//.test(normalized) || /\.(?:test|spec)\.[^.]+$/.test(normalized)) return 'test';
  if (
    /(?:^|\/)(?:package\.json|tsconfig(?:\.[^.]+)?\.json|vite\.config\.[^.]+|eslint\.config\.[^.]+|\.env(?:\.[^.]+)?|[^/]+\.(?:ya?ml|toml|ini))$/.test(normalized)
  ) {
    return 'configuration';
  }
  if (/\.(?:md|mdx|rst|adoc)$/.test(normalized) || /(?:^|\/)docs?\//.test(normalized)) return 'documentation';
  if (/\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|cpp|c|h)$/.test(normalized)) return 'source_file';
  return 'unknown';
}

function pushArtifact(
  artifacts: ArtifactSignal[],
  seen: Set<string>,
  artifact: ArtifactSignal
): void {
  const key = `${artifact.kind}:${artifact.path ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  artifacts.push(artifact);
}
