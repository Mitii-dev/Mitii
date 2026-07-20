import type {
  ArtifactClassification,
  ArtifactKind,
  ArtifactSignal,
  KnownProjectRef,
} from '../types';

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

/** Explicit `@project` mentions such as `@ai-service` or `@frontend`. */
const PROJECT_REFERENCE_RE = /(?:^|[\s(,])@([\w.-]+)\b/g;

export interface ClassifyArtifactsOptions {
  knownProjects?: readonly KnownProjectRef[];
}

export function classifyArtifacts(
  message: string,
  options: ClassifyArtifactsOptions = {}
): ArtifactClassification {
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

  for (const project of resolveProjectMentions(normalized, options.knownProjects)) {
    pushArtifact(artifacts, seen, project);
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
  // Check the specific-file extension first — `.mitii/logs/session.jsonl` names a single
  // log file, not the logs directory, even though it matches the directory-prefix regex below.
  if (/\.jsonl$/.test(normalized)) return 'jsonl_file';
  if (/(?:^|\/)\.mitii\/logs(?:\/|$)/.test(normalized)) return 'log_directory';
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

/**
 * Persistent workspace diagnostic dumps are not live evidence for the current task.
 * Prefer the current turn's `run_command` / verification output instead.
 */
export function isStaleDiagnosticLogPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const basename = normalized.split('/').pop() ?? normalized;
  if (basename === '.mitii-state.json') return true;
  // `.mitii/diagnostics/<sessionId>/...` is DiagnosticsStore's first-class, timestamped
  // evidence store (see DiagnosticsStore.ts) — reading it back is exactly how a step is
  // supposed to consume the files/errors a prior failing build already captured, not a
  // stale leftover dump. Only the ad hoc `*-error.log` filename patterns below are stale.
  if (/(?:^|\/)\.mitii\/(?:logs|debug-blobs|diagnostics)\//.test(normalized)) return false;
  return /(?:^|\/)(?:build-error|typecheck-error|tsc-error|compile-error)(?:[-_.].*)?\.log$/.test(normalized) ||
    /(?:^|\/)(?:.*[-_])?(?:build|typecheck|tsc|compile)[-_]?errors?\.log$/.test(normalized);
}

export function resolveProjectMentions(
  message: string,
  knownProjects?: readonly KnownProjectRef[]
): ArtifactSignal[] {
  const artifacts: ArtifactSignal[] = [];
  const seen = new Set<string>();
  for (const match of message.matchAll(PROJECT_REFERENCE_RE)) {
    const mention = match[1]?.trim();
    if (!mention || mention.length < 2) continue;
    // Skip common non-project @handles (emails already excluded by \b; keep chat noise out).
    if (/^(?:here|channel|everyone|user|agent|ai)$/i.test(mention)) continue;

    const resolved = matchKnownProject(mention, knownProjects);
    if (resolved) {
      pushArtifact(artifacts, seen, {
        kind: 'project',
        path: resolved.root === '.' ? resolved.id : resolved.root,
        projectId: resolved.id,
        source: 'explicit',
        confidence: 1,
      });
      continue;
    }

    // Without a catalog hit, still treat `@name` as an explicit project/directory target
    // so downstream scoping does not fall back to the whole workspace.
    pushArtifact(artifacts, seen, {
      kind: 'project',
      path: mention,
      projectId: mention,
      source: 'explicit',
      confidence: 0.7,
    });
  }
  return artifacts;
}

function matchKnownProject(
  mention: string,
  knownProjects?: readonly KnownProjectRef[]
): KnownProjectRef | undefined {
  if (!knownProjects?.length) return undefined;
  const needle = mention.toLowerCase();
  const scored = knownProjects
    .map((project) => {
      const aliases = [project.id, project.root, project.name, project.root.split('/').at(-1)]
        .filter((value): value is string => Boolean(value) && value !== '.')
        .map((value) => value.toLowerCase());
      let score = 0;
      for (const alias of aliases) {
        if (alias === needle) score = Math.max(score, 100);
        else if (alias.endsWith(`/${needle}`) || alias.startsWith(`${needle}/`)) score = Math.max(score, 80);
        else if (alias.includes(needle) && needle.length >= 3) score = Math.max(score, 40);
      }
      return { project, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 40 ? scored[0].project : undefined;
}

function pushArtifact(
  artifacts: ArtifactSignal[],
  seen: Set<string>,
  artifact: ArtifactSignal
): void {
  const key = `${artifact.kind}:${artifact.path ?? ''}:${artifact.projectId ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  artifacts.push(artifact);
}
