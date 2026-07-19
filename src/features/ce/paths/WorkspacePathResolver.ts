import { basename, dirname, extname, join } from 'path';
import { existsSync } from 'fs';
import type { ThunderDb } from '../../../features/ce/indexing/ThunderDb';
import type { IgnoreService } from '../../../features/ce/indexing/IgnoreService';
import {
  findSimilarWorkspacePaths,
  normalizeRelPath,
  normalizeWorkspaceRoot,
  pathExistenceVariants,
  resolveWorkspaceRelPath,
} from '../../../kernel/util/paths';

export type PathResolutionSource =
  | 'exact'
  | 'variant'
  | 'index-basename'
  | 'index-suffix'
  | 'index-segment'
  | 'filesystem'
  | 'folder-file-pattern';

export interface PathResolutionCandidate {
  relPath: string;
  score: number;
  source: PathResolutionSource;
  reason: string;
}

export interface PathResolutionResult {
  requestedPath: string;
  normalizedRequest: string;
  resolvedPath?: string;
  autoResolved: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  candidates: PathResolutionCandidate[];
}

export interface WorkspacePathResolverOptions {
  workspace: string;
  db?: ThunderDb;
  ignoreService?: IgnoreService;
  scopeRoot?: string;
  limit?: number;
}

const AUTO_RESOLVE_MIN_SCORE = 820;
const AUTO_RESOLVE_GAP = 120;

export class WorkspacePathResolver {
  private readonly workspace: string;
  private readonly root: string | null;
  private readonly db?: ThunderDb;
  private readonly ignoreService?: IgnoreService;
  private readonly scopeRoot?: string;
  private readonly limit: number;

  constructor(options: WorkspacePathResolverOptions) {
    this.workspace = options.workspace;
    this.root = normalizeWorkspaceRoot(options.workspace);
    this.db = options.db;
    this.ignoreService = options.ignoreService;
    this.scopeRoot = options.scopeRoot?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    this.limit = options.limit ?? 8;
  }

  resolve(rawPath: string): PathResolutionResult {
    const normalizedRequest = resolveWorkspaceRelPath(this.workspace, rawPath) ?? '';
    const base: PathResolutionResult = {
      requestedPath: rawPath,
      normalizedRequest,
      autoResolved: false,
      confidence: 'none',
      candidates: [],
    };

    if (!this.root || normalizedRequest === null) {
      return base;
    }

    if (normalizedRequest && this.pathExists(normalizedRequest)) {
      return {
        ...base,
        resolvedPath: normalizedRequest,
        confidence: 'high',
        candidates: [{
          relPath: normalizedRequest,
          score: 1000,
          source: 'exact',
          reason: 'Path exists on disk',
        }],
      };
    }

    const ranked = this.collectCandidates(normalizedRequest || normalizeRelPath(rawPath));
    base.candidates = ranked.slice(0, this.limit);

    if (ranked.length === 0) {
      return base;
    }

    const best = ranked[0];
    const second = ranked[1];
    const gap = second ? best.score - second.score : AUTO_RESOLVE_GAP + 1;
    const autoResolved = best.score >= AUTO_RESOLVE_MIN_SCORE && gap >= AUTO_RESOLVE_GAP;

    if (autoResolved) {
      return {
        ...base,
        resolvedPath: best.relPath,
        autoResolved: true,
        confidence: 'high',
        candidates: ranked.slice(0, this.limit),
      };
    }

    if (ranked.length === 1 && best.score >= 650) {
      return {
        ...base,
        resolvedPath: best.relPath,
        autoResolved: true,
        confidence: 'medium',
        candidates: ranked,
      };
    }

    return {
      ...base,
      confidence: ranked.length === 1 ? 'medium' : 'low',
      candidates: ranked.slice(0, this.limit),
    };
  }

  formatUnresolvedMessage(rawPath: string, result: PathResolutionResult): string {
    if (result.candidates.length === 0) {
      return `File not found: ${rawPath}. Use resolve_path, search, or list_files to locate the file before reading.`;
    }
    const lines = [
      `File not found: ${rawPath}`,
      'Ranked workspace matches (use resolve_path or read_file with an exact path):',
      ...result.candidates.map(
        (c, i) => `${i + 1}. ${c.relPath} — ${c.reason} (score ${c.score}, ${c.source})`
      ),
    ];
    if (result.confidence === 'medium' && result.candidates[0]) {
      lines.push(`Most likely: ${result.candidates[0].relPath}`);
    }
    return lines.join('\n');
  }

  formatAutoResolvedNote(rawPath: string, resolvedPath: string, candidate: PathResolutionCandidate): string {
    return [
      `[Path auto-resolved] ${rawPath} → ${resolvedPath}`,
      `Reason: ${candidate.reason} (${candidate.source}, score ${candidate.score})`,
      '---',
    ].join('\n');
  }

  private collectCandidates(requestedRelPath: string): PathResolutionCandidate[] {
    const scored = new Map<string, PathResolutionCandidate>();

    const add = (relPath: string, score: number, source: PathResolutionSource, reason: string) => {
      const norm = normalizeRelPath(relPath);
      if (!norm || !this.isAllowed(norm)) return;
      if (!this.pathExists(norm)) return;
      const existing = scored.get(norm);
      if (!existing || score > existing.score) {
        scored.set(norm, { relPath: norm, score, source, reason });
      }
    };

    for (const variant of pathExistenceVariants(requestedRelPath)) {
      add(variant, 920, 'variant', 'Extension or index naming variant');
    }

    this.addIndexCandidates(requestedRelPath, add);
    this.addFolderFilePatternCandidates(requestedRelPath, add);

    if (this.root) {
      for (const relPath of findSimilarWorkspacePaths(this.workspace, requestedRelPath, this.limit * 2)) {
        const score = this.scoreCandidate(requestedRelPath, relPath, 'filesystem');
        add(relPath, score, 'filesystem', 'Filesystem basename / variant walk');
      }
    }

    return [...scored.values()].sort((a, b) => b.score - a.score);
  }

  private addIndexCandidates(
    requestedRelPath: string,
    add: (relPath: string, score: number, source: PathResolutionSource, reason: string) => void
  ): void {
    if (!this.db?.isOpen() || !this.root) return;

    const fileName = basename(requestedRelPath);
    const stem = fileName.replace(/\.[^.]+$/, '');
    const parent = dirname(requestedRelPath).replace(/\\/g, '/');

    const queries: Array<{ sql: string; params: unknown[]; source: PathResolutionSource; reason: string }> = [
      {
        sql: 'SELECT rel_path FROM files WHERE workspace = ? AND rel_path LIKE ? ORDER BY rel_path LIMIT ?',
        params: [this.workspace, `%/${fileName}`, this.limit * 3],
        source: 'index-basename',
        reason: 'Indexed path ends with requested filename',
      },
      {
        sql: 'SELECT rel_path FROM files WHERE workspace = ? AND lower(rel_path) LIKE ? ORDER BY rel_path LIMIT ?',
        params: [this.workspace, `%${stem.toLowerCase()}%`, this.limit * 3],
        source: 'index-segment',
        reason: 'Indexed path contains requested stem',
      },
    ];

    if (parent && parent !== '.') {
      queries.push({
        sql: 'SELECT rel_path FROM files WHERE workspace = ? AND rel_path LIKE ? ORDER BY rel_path LIMIT ?',
        params: [this.workspace, `${parent}/%`, this.limit * 3],
        source: 'index-suffix',
        reason: 'Indexed path under requested parent directory',
      });
    }

    for (const query of queries) {
      try {
        const rows = this.db.raw.prepare(query.sql).all(...query.params) as Array<{ rel_path: string }>;
        for (const row of rows) {
          const score = this.scoreCandidate(requestedRelPath, row.rel_path, query.source);
          add(row.rel_path, score, query.source, query.reason);
        }
      } catch {
        // Index may be unavailable during early startup.
      }
    }
  }

  private addFolderFilePatternCandidates(
    requestedRelPath: string,
    add: (relPath: string, score: number, source: PathResolutionSource, reason: string) => void
  ): void {
    const fileName = basename(requestedRelPath);
    const stem = fileName.replace(/\.[^.]+$/, '');
    if (!stem || stem.length < 3) return;

    const parent = dirname(requestedRelPath).replace(/\\/g, '/');
    const nested = parent === '.' ? `${stem}/${fileName}` : `${parent}/${stem}/${fileName}`;
    add(nested, 960, 'folder-file-pattern', 'Folder named like file stem (package-style field layout)');

    const indexNested = parent === '.' ? `${stem}/index${extname(fileName)}` : `${parent}/${stem}/index${extname(fileName)}`;
    add(indexNested, 880, 'folder-file-pattern', 'index file inside stem-named folder');
  }

  private scoreCandidate(
    requestedRelPath: string,
    candidateRelPath: string,
    source: PathResolutionSource
  ): number {
    const req = requestedRelPath.replace(/\\/g, '/');
    const cand = candidateRelPath.replace(/\\/g, '/');
    if (req === cand) return 1000;

    let score = source === 'filesystem' ? 520 : 600;
    if (basename(req) === basename(cand)) score += 120;

    const prefix = longestCommonPathPrefix(req, cand);
    score += prefix.split('/').filter(Boolean).length * 35;

    score += folderFilePatternBoost(req, cand);

    if (cand.endsWith(req) || req.endsWith(basename(cand))) score += 80;
    if (cand.includes(req)) score += 40;

    return score;
  }

  private pathExists(relPath: string): boolean {
    if (!this.root) return false;
    try {
      return existsSync(join(this.root, relPath));
    } catch {
      return false;
    }
  }

  private isAllowed(relPath: string): boolean {
    if (!this.scopeRoot) return !this.ignoreService?.isIgnored(relPath, { forRead: true });
    const norm = normalizeRelPath(relPath);
    const scope = normalizeRelPath(this.scopeRoot);
    if (!norm.startsWith(scope)) return false;
    return !this.ignoreService?.isIgnored(relPath, { forRead: true });
  }
}

function longestCommonPathPrefix(a: string, b: string): string {
  const aParts = a.split('/').filter(Boolean);
  const bParts = b.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    if (aParts[i] !== bParts[i]) break;
    out.push(aParts[i]);
  }
  return out.join('/');
}

function folderFilePatternBoost(requested: string, candidate: string): number {
  const reqFile = basename(requested);
  const reqStem = reqFile.replace(/\.[^.]+$/, '');
  const candFile = basename(candidate);
  const candParent = basename(dirname(candidate));

  if (candFile === reqFile && candParent === reqStem) {
    return 260;
  }

  const expected = `${dirname(requested).replace(/\\/g, '/')}/${reqStem}/${reqFile}`.replace(/^\.\//, '');
  if (candidate.replace(/\\/g, '/') === expected) {
    return 280;
  }

  return 0;
}

export function createWorkspacePathResolver(options: WorkspacePathResolverOptions): WorkspacePathResolver {
  return new WorkspacePathResolver(options);
}
