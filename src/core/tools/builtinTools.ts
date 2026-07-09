import { AGENT_NAME } from '../../shared/brand';
import { z } from 'zod';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolResult } from './types';
import type { IgnoreService } from '../indexing/IgnoreService';
import type { FtsIndex } from '../indexing/FtsIndex';
import type { RepoMapService } from '../context/RepoMapService';
import type { GitService } from '../context/GitService';
import type { DiagnosticsService } from '../context/DiagnosticsService';
import type { HybridRetriever } from '../context/HybridRetriever';
import type { ContextBudgeter } from '../context/ContextBudgeter';
import type { MemoryService } from '../memory/MemoryService';
import { PatchApplyService } from '../apply/PatchApplyService';
import { validateMdxContent } from '../apply/mdxValidation';
import { isDangerousCommand } from '../safety/ToolPolicyEngine';
import { isReadOnlyCommand, stripLeadingCd } from '../plans/PlanActEngine';
import { normalizeWorkspaceRoot, resolveWorkspaceRelPath, formatPathNotFoundHint } from '../util/paths';
import type { ThunderDb } from '../indexing/ThunderDb';
import { createWorkspacePathResolver } from '../paths/WorkspacePathResolver';
import { BaseSubagent, createDefaultSubagentRegistry, loadWorkspaceAgents, type SubagentRuntime } from '../subagents';
import { isAuditSubagentBlocked, buildScriptFirstAuditMessage } from '../runtime/auditRouting';
import type { SubagentTracker } from '../runtime/SubagentTracker';
import type { SkillCatalogService } from '../skills/SkillCatalogService';
import { createLogger } from '../telemetry/Logger';
import { analyzeChangeImpact, discoverProjectCatalog, formatProjectCatalog, saveProjectCatalog } from '../modes/ask';
import { filterItemsToScope, normalizeScopeRoot } from '../context/scopeFilter';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const log = createLogger('BuiltinTools');

export type ResearchAgentRuntime = SubagentRuntime;

let subagentRuntime: SubagentRuntime | undefined;
let subagentTracker: SubagentTracker | undefined;
let activeSubagents = 0;

export function setSubagentTracker(tracker: SubagentTracker | undefined): void {
  subagentTracker = tracker;
}

export function setResearchAgentRuntime(runtime: ResearchAgentRuntime | undefined): void {
  setSubagentRuntime(runtime);
}

export function setSubagentRuntime(runtime: SubagentRuntime | undefined): void {
  subagentRuntime = runtime;
}

function blockedPath(relPath: string, ignoreService: IgnoreService, forRead = false): boolean {
  if (relPath.includes('..')) return true;
  return ignoreService.isIgnored(relPath, { forRead });
}

function resolveToolPath(workspace: string, rawPath: string, ignoreService: IgnoreService, forRead = false): string | null {
  const relPath = resolveWorkspaceRelPath(workspace, rawPath);
  if (relPath === null) return null;
  if (blockedPath(relPath, ignoreService, forRead)) return null;
  return relPath;
}


const SOURCE_FILE_PATTERN = /\.(?:tsx?|jsx?|mjs|cjs|css|scss|sass|less|json|ya?ml)$/i;
const READ_FILE_MAX_CHARS = 50000;
const READ_FILES_MAX_PATHS = 12;
const SHELL_COMMAND_CONTENT_PREFIX =
  /^(?:git\s+(?:checkout|restore|reset|clean|pull|push|commit|merge|rebase|switch)\b|(?:npm|yarn|pnpm|npx)\s+|rm\s+-|mv\s+|cp\s+|sed\s+-i\b|cat\s+>|echo\s+.+>|python(?:3)?\s+|node\s+|bash\s+|sh\s+)/i;

interface ReadFileCacheEntry {
  content: string;
  mtimeMs: number;
  size: number;
}

const readFileCaches = new Map<string, Map<string, ReadFileCacheEntry>>();

function readFileCacheKey(workspace: string): string {
  return normalizeWorkspaceRoot(workspace) ?? workspace;
}

function getReadFileCache(workspace: string): Map<string, ReadFileCacheEntry> {
  const key = readFileCacheKey(workspace);
  let cache = readFileCaches.get(key);
  if (!cache) {
    cache = new Map();
    readFileCaches.set(key, cache);
  }
  return cache;
}

export function clearReadFileCache(workspace?: string): void {
  if (workspace) {
    readFileCaches.delete(readFileCacheKey(workspace));
    return;
  }
  readFileCaches.clear();
}

function updateReadFileCache(workspace: string, relPath: string, content: string): void {
  try {
    const st = statSync(join(workspace, relPath));
    getReadFileCache(workspace).set(relPath, {
      content: content.slice(0, READ_FILE_MAX_CHARS),
      mtimeMs: st.mtimeMs,
      size: st.size,
    });
  } catch {
    getReadFileCache(workspace).delete(relPath);
  }
}

function validateWriteFileContent(relPath: string, content: string): string | undefined {
  const mdxValidationError = validateMdxContent(relPath, content);
  if (mdxValidationError) return mdxValidationError;

  if (!SOURCE_FILE_PATTERN.test(relPath)) return undefined;

  const firstLine = content.trimStart().split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (SHELL_COMMAND_CONTENT_PREFIX.test(firstLine)) {
    return [
      `Refusing to write ${relPath}: content starts with a shell command.`,
      'Use run_command for shell commands, or provide real source code for write_file.',
    ].join(' ');
  }

  return undefined;
}

export function createReadFileTool(
  workspace: string,
  ignoreService: IgnoreService,
  db?: ThunderDb
): Tool<{ path: string }> {
  return {
    name: 'read_file',
    description:
      'Read one workspace file. Missing paths are auto-resolved via the workspace index when confidence is high. For multiple files, prefer read_files. Use resolve_path when unsure.',
    risk: 'low',
    inputSchema: z.object({ path: z.string() }),
    async execute(input): Promise<ToolResult> {
      return readSingleFile(workspace, input.path, ignoreService, db);
    },
  };
}

export function createReadFilesTool(
  workspace: string,
  ignoreService: IgnoreService,
  db?: ThunderDb
): Tool<{ paths: string[] }> {
  return {
    name: 'read_files',
    description:
      'Read multiple workspace files in one call. Max 12 paths per call; prefer 8-10. Missing paths are auto-resolved when confidence is high. Use resolve_path for uncertain paths.',
    risk: 'low',
    inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
    parametersJsonSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: READ_FILES_MAX_PATHS,
          description: 'Workspace-relative file paths. Never send more than 12; prefer batches of 8-10.',
        },
      },
      required: ['paths'],
    },
    async execute(input): Promise<ToolResult> {
      const parts: string[] = [];
      const paths = input.paths.slice(0, READ_FILES_MAX_PATHS);
      if (input.paths.length > READ_FILES_MAX_PATHS) {
        parts.push(
          `NOTE: read_files accepts at most ${READ_FILES_MAX_PATHS} paths per call. ` +
          `Reading the first ${READ_FILES_MAX_PATHS}; call read_files again for: ` +
          input.paths.slice(READ_FILES_MAX_PATHS).join(', ')
        );
      }
      const results = await Promise.all(paths.map(async (path) => ({
        path,
        result: await readSingleFile(workspace, path, ignoreService, db),
      })));
      for (const { path, result } of results) {
        parts.push(result.success
          ? `### ${path}\n${result.output}`
          : `### ${path}\nERROR: ${result.error}`);
      }
      return { success: true, output: parts.join('\n\n') };
    },
  };
}

async function readWorkspaceFileContent(
  workspace: string,
  relPath: string
): Promise<{ success: true; output: string } | { success: false; error: string }> {
  try {
    const fullPath = join(workspace, relPath);
    const st = statSync(fullPath);
    if (!st.isFile()) {
      return { success: false, error: `Not a file: ${relPath}` };
    }
    const cached = getReadFileCache(workspace).get(relPath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return { success: true, output: cached.content };
    }
    const content = await readFile(fullPath, 'utf-8');
    getReadFileCache(workspace).set(relPath, {
      content: content.slice(0, READ_FILE_MAX_CHARS),
      mtimeMs: st.mtimeMs,
      size: st.size,
    });
    return { success: true, output: content.slice(0, READ_FILE_MAX_CHARS) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Reads a file outside the workspace. Only reachable after the user has explicitly
 * approved the read_file/read_files call via the approval queue (see ToolExecutor.executeApproved)
 * — readSingleFile below always refuses external paths outright as a defense-in-depth boundary.
 */
export async function readApprovedExternalFile(rawPath: string): Promise<ToolResult> {
  try {
    const st = statSync(rawPath);
    if (!st.isFile()) {
      return { success: false, output: '', error: `Not a file: ${rawPath}` };
    }
    const content = await readFile(rawPath, 'utf-8');
    return {
      success: true,
      output: `[External file outside the workspace — read with user approval]\n${content.slice(0, READ_FILE_MAX_CHARS)}`,
    };
  } catch (e) {
    return { success: false, output: '', error: String(e) };
  }
}

export async function readApprovedExternalFiles(rawPaths: string[]): Promise<ToolResult> {
  const results = await Promise.all(
    rawPaths.map(async (path) => ({ path, result: await readApprovedExternalFile(path) }))
  );
  const parts = results.map(({ path, result }) => (
    result.success ? `### ${path}\n${result.output}` : `### ${path}\nERROR: ${result.error}`
  ));
  return { success: true, output: parts.join('\n\n') };
}

async function readSingleFile(
  workspace: string,
  rawPath: string,
  ignoreService: IgnoreService,
  db?: ThunderDb
): Promise<ToolResult> {
  const relPath = resolveWorkspaceRelPath(workspace, rawPath);
  if (relPath === null) {
    return { success: false, output: '', error: 'Invalid path — use workspace-relative paths like apps/docs/docusaurus.config.ts' };
  }
  if (ignoreService.isIgnored(relPath, { forRead: true })) {
    return {
      success: false,
      output: '',
      error: `Path is ignored: ${rawPath}. For built package exports read packages/*/src/index.ts instead of dist/.`,
    };
  }

  const direct = await readWorkspaceFileContent(workspace, relPath);
  if (direct.success) {
    return { success: true, output: direct.output };
  }

  const resolver = createWorkspacePathResolver({ workspace, db, ignoreService });
  const resolution = resolver.resolve(rawPath);

  if (resolution.autoResolved && resolution.resolvedPath && resolution.resolvedPath !== relPath) {
    if (ignoreService.isIgnored(resolution.resolvedPath, { forRead: true })) {
      return {
        success: false,
        output: '',
        error: `Resolved path is ignored: ${resolution.resolvedPath}`,
      };
    }
    const resolvedRead = await readWorkspaceFileContent(workspace, resolution.resolvedPath);
    if (resolvedRead.success) {
      const candidate = resolution.candidates.find((c) => c.relPath === resolution.resolvedPath)
        ?? resolution.candidates[0];
      const prefix = candidate
        ? `${resolver.formatAutoResolvedNote(rawPath, resolution.resolvedPath, candidate)}\n`
        : `[Path auto-resolved] ${rawPath} → ${resolution.resolvedPath}\n---\n`;
      updateReadFileCache(workspace, resolution.resolvedPath, resolvedRead.output);
      return { success: true, output: `${prefix}${resolvedRead.output}` };
    }
  }

  if (resolution.candidates.length > 0) {
    return {
      success: false,
      output: '',
      error: resolver.formatUnresolvedMessage(rawPath, resolution),
    };
  }

  return {
    success: false,
    output: '',
    error: `File not found: ${rawPath}. Use resolve_path, search, or list_files before reading.`,
  };
}

export function createResolvePathTool(
  workspace: string,
  ignoreService: IgnoreService,
  db?: ThunderDb
): Tool<{ path: string; scopeRoot?: string }> {
  return {
    name: 'resolve_path',
    description:
      'Resolve a workspace file path using the SQLite index, layout heuristics, and filesystem search. Returns ranked candidates and auto-resolution when confidence is high. Use before read_file when the exact path is uncertain.',
    risk: 'low',
    inputSchema: z.object({
      path: z.string(),
      scopeRoot: z.string().optional(),
    }),
    async execute(input): Promise<ToolResult> {
      const resolver = createWorkspacePathResolver({
        workspace,
        db,
        ignoreService,
        scopeRoot: input.scopeRoot,
      });
      const result = resolver.resolve(input.path);
      const lines = [
        `Requested: ${input.path}`,
        `Normalized: ${result.normalizedRequest || '(invalid)'}`,
        `Confidence: ${result.confidence}`,
      ];
      if (result.autoResolved && result.resolvedPath) {
        lines.push(`Auto-resolved: ${result.resolvedPath}`);
      }
      if (result.candidates.length === 0) {
        lines.push('No indexed or filesystem matches. Try search or list_files on the parent directory.');
      } else {
        lines.push('Candidates:');
        for (const [index, candidate] of result.candidates.entries()) {
          lines.push(
            `${index + 1}. ${candidate.relPath} (score ${candidate.score}, ${candidate.source}) — ${candidate.reason}`
          );
        }
      }
      return { success: true, output: lines.join('\n') };
    },
  };
}

export function createListFilesTool(
  workspace: string,
  ignoreService: IgnoreService
): Tool<{ path?: string; recursive?: boolean }> {
  return {
    name: 'list_files',
    description: 'List files in a directory. Set recursive:true to walk subdirectories (max depth 8).',
    risk: 'low',
    inputSchema: z.object({ path: z.string().optional(), recursive: z.boolean().optional() }),
    async execute(input): Promise<ToolResult> {
      const relPath = resolveWorkspaceRelPath(workspace, input.path);
      if (relPath === null) {
        return { success: false, output: '', error: 'Path is ignored or blocked' };
      }
      if (relPath && ignoreService.isIgnored(relPath, { forRead: true })) {
        return { success: false, output: '', error: 'Path is ignored' };
      }
      const listRel = relPath || '.';
      try {
        const base = relPath ? join(workspace, relPath) : workspace;
        if (!input.recursive) {
          const entries = readdirSync(base).filter((entry) => {
            const entryRel = relPath ? join(listRel, entry).replace(/\\/g, '/') : entry;
            try {
              const stat = statSync(join(base, entry));
              return !ignoreService.isIgnored(stat.isDirectory() ? `${entryRel}/` : entryRel);
            } catch {
              return false;
            }
          });
          return { success: true, output: entries.join('\n') };
        }
        const files = walkDir(workspace, listRel, ignoreService, 8, 500);
        return { success: true, output: files.join('\n') || '(empty)' };
      } catch (e) {
        const err = String(e);
        if (err.includes('ENOENT') && input.path) {
          return {
            success: false,
            output: '',
            error: formatPathNotFoundHint(workspace, input.path, relPath || input.path),
          };
        }
        return { success: false, output: '', error: err };
      }
    },
  };
}

function walkDir(
  workspace: string,
  relDir: string,
  ignoreService: IgnoreService,
  maxDepth: number,
  maxFiles: number
): string[] {
  const results: string[] = [];
  const walk = (currentRel: string, depth: number): void => {
    if (results.length >= maxFiles || depth > maxDepth) return;
    const abs = join(workspace, currentRel === '.' ? '' : currentRel);
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const childRel = currentRel === '.' ? entry : `${currentRel}/${entry}`;
      if (ignoreService.isIgnored(childRel)) continue;
      const childAbs = join(workspace, childRel);
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(childRel, depth + 1);
      } else {
        results.push(childRel);
      }
    }
  };
  walk(relDir, 0);
  return results;
}

async function ripgrepSearch(workspace: string, query: string, limit: number, scopeRoot?: string): Promise<string | null> {
  try {
    const rg = await import('@vscode/ripgrep');
    const rgPath = rg.rgPath;
    const scope = normalizeScopeRoot(scopeRoot);
    const target = scope ? JSON.stringify(scope) : '.';
    const { stdout } = await execAsync(
      `"${rgPath}" --no-heading --line-number --max-count ${limit} --regexp ${JSON.stringify(query)} ${target}`,
      { cwd: workspace, maxBuffer: 2 * 1024 * 1024, timeout: 15000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function createSearchTool(fts: FtsIndex, workspace?: string): Tool<{ query: string; limit?: number; scopeRoot?: string }> {
  return {
    name: 'search',
    description: 'Search code (FTS index + ripgrep, merged). For multiple patterns, use search_batch in one call. Use scopeRoot to limit to one project/package. Copy rel_path values exactly into read_file.',
    risk: 'low',
    inputSchema: z.object({ query: z.string(), limit: z.number().optional(), scopeRoot: z.string().optional() }),
    async execute(input): Promise<ToolResult> {
      const output = await runSearch(fts, workspace, input.query, input.limit ?? 10, input.scopeRoot);
      return { success: true, output: output || '(no results)' };
    },
  };
}

export function createSearchBatchTool(fts: FtsIndex, workspace?: string): Tool<{ queries: string[]; limit?: number; scopeRoot?: string }> {
  return {
    name: 'search_batch',
    description: 'Run multiple scoped code searches in parallel. queries must be a JSON array of strings, e.g. ["dayjs","@fontsource"].',
    risk: 'low',
    inputSchema: z.object({
      queries: z.array(z.string()).min(1).max(10),
      limit: z.number().optional(),
      scopeRoot: z.string().optional(),
    }),
    async execute(input): Promise<ToolResult> {
      const limit = input.limit ?? 8;
      const results = await Promise.all(
        input.queries.slice(0, 10).map(async (query) => {
          const output = await runSearch(fts, workspace, query, limit, input.scopeRoot);
          return `## Query: ${query}\n${output || '(no results)'}`;
        })
      );
      return { success: true, output: results.join('\n\n') };
    },
  };
}

interface ScriptCatalogEntry {
  id: number;
  name: string;
  category: string;
  command: string;
  description: string;
  keywords?: string[];
  readOnly: boolean;
}

export function createSearchScriptCatalogTool(
  workspace: string,
  extensionRoot: string
): Tool<{ query: string; limit?: number }> {
  return {
    name: 'search_script_catalog',
    description:
      `Search ${AGENT_NAME} helper scripts by intent. Use before running specialized audits so only the relevant script name and command enter context.`,
    risk: 'low',
    inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
    async execute(input): Promise<ToolResult> {
      const catalog = readScriptCatalog(workspace, extensionRoot);
      const matches = searchScriptCatalog(catalog, input.query, input.limit ?? 5);
      return {
        success: true,
        output: matches.length ? JSON.stringify({ query: input.query, matches }, null, 2) : '(no matching scripts)',
      };
    },
  };
}

export function createExecuteWorkspaceScriptTool(
  workspace: string,
  extensionRoot: string,
  ignoreService: IgnoreService
): Tool<{ script: string; target?: string; text?: string }> {
  return {
    name: 'execute_workspace_script',
    description:
      'Run one approved workspace helper script by enum name. Use this instead of raw run_command for audits, dependency checks, safe lint, and checkpoints.',
    risk: 'medium',
    inputSchema: z.object({
      script: z.string(),
      target: z.string().optional(),
      text: z.string().optional(),
    }),
    parametersJsonSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          enum: readScriptCatalog(workspace, extensionRoot).map((s) => s.name),
        },
        target: {
          type: 'string',
          description: 'Optional workspace-relative target path for scripts that accept a file or directory.',
        },
        text: {
          type: 'string',
          description: 'Optional checkpoint text for write-checkpoint.sh.',
        },
      },
      required: ['script'],
    },
    async execute(input): Promise<ToolResult> {
      const catalog = readScriptCatalog(workspace, extensionRoot);
      const entry = catalog.find((s) => s.name === input.script);
      if (!entry) {
        return {
          success: false,
          output: '',
          error: `Unknown script "${input.script}". Use search_script_catalog first.`,
        };
      }

      const scriptPath = resolveCatalogScript(workspace, extensionRoot, entry.name);
      if (!scriptPath) {
        return { success: false, output: '', error: `Script file not found: ${entry.name}` };
      }

      const args: string[] = [scriptPath];
      if (input.target) {
        const relTarget = resolveToolPath(workspace, input.target, ignoreService);
        if (!relTarget) {
          return { success: false, output: '', error: 'Invalid or ignored target path' };
        }
        args.push(relTarget);
      }

      const runner = entry.name.endsWith('.mjs') ? process.execPath : 'bash';
      try {
        const { stdout, stderr } = await execFileAsync(runner, args, {
          cwd: workspace,
          maxBuffer: 2 * 1024 * 1024,
          timeout: 120000,
          env: {
            ...process.env,
            FORCE_COLOR: '0',
            THUNDER_CHECKPOINT_TEXT: input.text ?? process.env.THUNDER_CHECKPOINT_TEXT ?? '',
          },
        });
        const output = [stdout, stderr].filter(Boolean).join('\n').slice(0, 50000);
        return { success: true, output: output || '(no output)' };
      } catch (e) {
        const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
        const output = [err.stdout, err.stderr].filter(Boolean).join('\n').slice(0, 50000);
        if (entry.readOnly && (err.code === 1 || output.length > 0)) {
          return { success: true, output: output || '(no findings)' };
        }
        if (entry.name === 'write-checkpoint.sh') {
          return {
            success: false,
            skipped: true,
            output: output || err.message || 'Checkpoint helper failed',
            error: 'Non-fatal checkpoint helper failure',
          };
        }
        return { success: false, output, error: err.message ?? 'Script failed' };
      }
    },
  };
}

export function createUseSkillTool(skillCatalog: SkillCatalogService): Tool<{ name: string }> {
  return {
    name: 'use_skill',
    description:
      'Load a workspace skill playbook from .mitii/skills. Use when a named playbook or specialized workflow applies.',
    risk: 'low',
    inputSchema: z.object({ name: z.string() }),
    async execute(input): Promise<ToolResult> {
      const skill = skillCatalog.get(input.name);
      if (!skill) {
        const available = skillCatalog.list().map((s) => `${s.name}: ${s.description}`).join('\n');
        return {
          success: false,
          output: available || '(no workspace skills found)',
          error: `Skill not found: ${input.name}`,
        };
      }
      return {
        success: true,
        output: `# Skill: ${skill.entry.name}\nPath: ${skill.entry.relPath}\nDescription: ${skill.entry.description}\n\n${skill.content}`,
      };
    },
  };
}

function readScriptCatalog(workspace: string, extensionRoot: string): ScriptCatalogEntry[] {
  const workspaceCatalog = join(workspace, 'scripts', 'script-catalog.json');
  const bundledCatalog = join(extensionRoot, 'scripts', 'script-catalog.json');
  const catalogPath = pathExists(workspaceCatalog) ? workspaceCatalog : bundledCatalog;
  try {
    return JSON.parse(readFileSync(catalogPath, 'utf8')) as ScriptCatalogEntry[];
  } catch (e) {
    log.warn('Script catalog unavailable', { catalogPath, error: String(e) });
    return [];
  }
}

function resolveCatalogScript(workspace: string, extensionRoot: string, scriptName: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(scriptName)) return null;
  const workspacePath = join(workspace, 'scripts', scriptName);
  if (pathExists(workspacePath)) return workspacePath;
  const bundledPath = join(extensionRoot, 'scripts', scriptName);
  if (pathExists(bundledPath)) return bundledPath;
  return null;
}

function searchScriptCatalog(
  catalog: ScriptCatalogEntry[],
  query: string,
  limit: number
): Array<ScriptCatalogEntry & { score: number }> {
  const terms = tokenizeCatalogText(query);
  return catalog
    .map((entry) => ({ ...entry, score: terms.length ? scoreCatalogEntry(entry, terms, query) : 1 }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, Math.max(1, Math.min(limit, 10)));
}

function scoreCatalogEntry(entry: ScriptCatalogEntry, terms: string[], query: string): number {
  const haystack = [
    entry.name,
    entry.category,
    entry.command,
    entry.description,
    ...(entry.keywords ?? []),
  ].join(' ').toLowerCase();
  const words = new Set(tokenizeCatalogText(haystack));
  let score = haystack.includes(query.toLowerCase()) ? 10 : 0;
  for (const term of terms) {
    if (words.has(term)) score += 6;
    if (haystack.includes(term)) score += 3;
    for (const keyword of entry.keywords ?? []) {
      const keywordText = keyword.toLowerCase();
      if (keywordText === term) score += 8;
      else if (keywordText.includes(term)) score += 4;
    }
  }
  return score;
}

function tokenizeCatalogText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/)
    .filter(Boolean);
}

async function runSearch(
  fts: FtsIndex,
  workspace: string | undefined,
  query: string,
  limit: number,
  scopeRoot?: string
): Promise<string> {
  const ftsResults = filterItemsToScope(fts.search(query, limit), scopeRoot);
  const ftsLines = ftsResults.map((r) => `${r.relPath}: ${r.snippet}`);
  const seenPaths = new Set(ftsResults.map((r) => r.relPath));

  const rgLines: string[] = [];
  if (workspace) {
    const rgOut = await ripgrepSearch(workspace, query, limit, scopeRoot);
    if (rgOut) {
      for (const line of rgOut.split('\n')) {
        const relPath = line.split(':')[0]?.trim();
        if (relPath && !seenPaths.has(relPath)) {
          seenPaths.add(relPath);
        }
        rgLines.push(line);
      }
    }
  }

  const sections: string[] = [];
  if (ftsLines.length > 0) {
    sections.push(ftsLines.join('\n'));
  }
  if (rgLines.length > 0) {
    sections.push(`--- ripgrep ---\n${rgLines.join('\n')}`);
  }
  return sections.join('\n');
}

export function createRepoMapTool(repoMap: RepoMapService): Tool<{ query?: string }> {
  return {
    name: 'repo_map',
    description: 'Generate compact repo map',
    risk: 'low',
    inputSchema: z.object({ query: z.string().optional() }),
    async execute(input): Promise<ToolResult> {
      const map = repoMap.build({ query: input.query, maxChars: 6000 });
      return { success: true, output: map };
    },
  };
}

export function createRetrieveContextTool(retriever: HybridRetriever, budgeter: ContextBudgeter): Tool<{ query: string; scopeRoot?: string }> {
  return {
    name: 'retrieve_context',
    description: 'Build context pack for a query. Use scopeRoot to limit retrieval to one project/package.',
    risk: 'low',
    inputSchema: z.object({ query: z.string(), scopeRoot: z.string().optional() }),
    async execute(input): Promise<ToolResult> {
      const items = await retriever.retrieve({ text: input.query, scopeRoot: input.scopeRoot });
      const pack = budgeter.budget(items, 4000);
      return { success: true, output: pack.formatted };
    },
  };
}

export function createGitDiffTool(git: GitService): Tool<Record<string, never>> {
  return {
    name: 'git_diff',
    description: 'Get git diff',
    risk: 'low',
    inputSchema: z.object({}),
    async execute(): Promise<ToolResult> {
      const diff = await git.getDiff();
      return { success: true, output: diff || '(no changes)' };
    },
  };
}

export function createDiagnosticsTool(diagnostics: DiagnosticsService): Tool<Record<string, never>> {
  return {
    name: 'diagnostics',
    description: 'Get VS Code diagnostics',
    risk: 'low',
    inputSchema: z.object({}),
    async execute(): Promise<ToolResult> {
      return { success: true, output: diagnostics.formatCompact() || '(no diagnostics)' };
    },
  };
}

export function createProjectCatalogTool(workspace: string): Tool<Record<string, never>> {
  return {
    name: 'project_catalog',
    description: 'Detect workspace projects/packages and return their roots, types, entry files, and scripts.',
    risk: 'low',
    inputSchema: z.object({}),
    async execute(): Promise<ToolResult> {
      const catalog = discoverProjectCatalog(workspace);
      try {
        saveProjectCatalog(catalog);
      } catch {
        // Saving is best-effort; the catalog output is still useful.
      }
      return {
        success: true,
        output: JSON.stringify({
          ...catalog,
          formatted: formatProjectCatalog(catalog),
        }, null, 2),
      };
    },
  };
}

export function createAnalyzeChangeImpactTool(
  workspace: string
): Tool<{ feature: string; scopeRoot?: string; entrySymbols?: string[] }> {
  return {
    name: 'analyze_change_impact',
    description:
      'Read-only impact analysis for an implementation question. Returns likely files to modify/create, tests, dependencies, risks, and verify commands.',
    risk: 'low',
    inputSchema: z.object({
      feature: z.string(),
      scopeRoot: z.string().optional(),
      entrySymbols: z.array(z.string()).optional(),
    }),
    parametersJsonSchema: {
      type: 'object',
      properties: {
        feature: {
          type: 'string',
          description: 'Feature/change being considered, e.g. "add OAuth to the extension".',
        },
        scopeRoot: {
          type: 'string',
          description: 'Optional project root or project id from project_catalog.',
        },
        entrySymbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional starting symbols the user mentioned.',
        },
      },
      required: ['feature'],
    },
    async execute(input): Promise<ToolResult> {
      const analysis = analyzeChangeImpact(workspace, input.feature, input.scopeRoot, undefined, input.entrySymbols ?? []);
      return { success: true, output: JSON.stringify(analysis, null, 2) };
    },
  };
}

export function createMemorySearchTool(memory: MemoryService): Tool<{ query: string; limit?: number }> {
  return {
    name: 'memory_search',
    description: 'Search long-term memory observations',
    risk: 'low',
    inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
    async execute(input): Promise<ToolResult> {
      const results = await memory.searchAsync(input.query, input.limit ?? 10);
      const output = results.map((r) => `[${r.type}] ${r.text}`).join('\n');
      return { success: true, output: output || '(no memories)' };
    },
  };
}

export function createMemoryWriteTool(
  memory: MemoryService,
  getSessionId: () => string
): Tool<{ type: string; text: string; files?: string[] }> {
  return {
    name: 'memory_write',
    description: 'Save an observation to long-term memory. Alias: use save_task_state for approval pauses.',
    risk: 'medium',
    inputSchema: z.object({
      type: z.string(),
      text: z.string(),
      files: z.array(z.string()).optional(),
    }),
    async execute(input): Promise<ToolResult> {
      const obs = memory.write(getSessionId(), input.type as 'decision', input.text, input.files);
      if (!obs) {
        return { success: false, output: '', error: 'Memory write blocked (secrets or invalid)' };
      }
      return { success: true, output: `Saved memory #${obs.id}` };
    },
  };
}

export function createSaveTaskStateTool(
  memory: MemoryService,
  getSessionId: () => string,
  getTaskState?: () => import('../runtime/AgentTaskState').AgentTaskState | undefined
): Tool<{ summary: string; next_step?: string }> {
  return {
    name: 'save_task_state',
    description:
      'Save task progress before pausing for user approval. Required when about to wait for approval. ' +
      'Include what was analyzed and the concrete next step (e.g. "depcheck found @date-io/dayjs unused; next: npm uninstall").',
    risk: 'low',
    inputSchema: z.object({
      summary: z.string(),
      next_step: z.string().optional(),
    }),
    async execute(input): Promise<ToolResult> {
      const text = input.next_step
        ? `${input.summary}\n\nNext step: ${input.next_step}`
        : input.summary;
      getTaskState?.()?.setPauseSummary(text);
      const obs = memory.write(getSessionId(), 'decision', text, undefined, ['task_state']);
      if (!obs) {
        return { success: false, output: '', error: 'Task state save blocked (secrets or invalid)' };
      }
      return { success: true, output: `Task state saved (#${obs.id})` };
    },
  };
}

export function createWriteFileTool(workspace: string, ignoreService: IgnoreService): Tool<{ path: string; content: string }> {
  return {
    name: 'write_file',
    description: 'Write a file (requires approval)',
    risk: 'high',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    async execute(input): Promise<ToolResult> {
      const relPath = resolveToolPath(workspace, input.path, ignoreService);
      if (!relPath) {
        return { success: false, output: '', error: 'Invalid or ignored path' };
      }
      const validationError = validateWriteFileContent(relPath, input.content);
      if (validationError) {
        return { success: false, output: '', error: validationError };
      }
      try {
        const fullPath = join(workspace, relPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, input.content, 'utf-8');
        updateReadFileCache(workspace, relPath, input.content);
        return { success: true, output: `Wrote ${input.content.length} chars to ${relPath}` };
      } catch (e) {
        return { success: false, output: '', error: String(e) };
      }
    },
  };
}

export function createApplyPatchTool(workspace: string, ignoreService: IgnoreService): Tool<{ path: string; oldText: string; newText: string }> {
  const patchService = new PatchApplyService(workspace);
  return {
    name: 'apply_patch',
    description: 'Apply a targeted text replacement patch (requires approval). For TSX/JSX, patch complete logical blocks only: full import block, object, hook block, or component/function block.',
    risk: 'high',
    inputSchema: z.object({ path: z.string(), oldText: z.string(), newText: z.string() }),
    async execute(input): Promise<ToolResult> {
      const relPath = resolveToolPath(workspace, input.path, ignoreService);
      if (!relPath) {
        return { success: false, output: '', error: 'Invalid or ignored path' };
      }
      const result = patchService.apply({
        path: relPath,
        oldText: input.oldText,
        newText: input.newText,
      });
      if (!result.success && result.error?.includes('oldText not found')) {
        getReadFileCache(workspace).delete(relPath);
        const retry = patchService.apply({
          path: relPath,
          oldText: input.oldText,
          newText: input.newText,
        });
        if (retry.success) {
          if (retry.proposedContent) {
            updateReadFileCache(workspace, relPath, retry.proposedContent);
          }
          return {
            success: true,
            output: retry.proposedContent
              ? `Patch validated after re-read (${retry.proposedContent.length} chars)`
              : `Patched ${relPath}`,
          };
        }
      }
      if (!result.success) {
        return { success: false, output: '', error: result.error ?? 'Patch failed' };
      }
      const note = result.proposedContent
        ? `Patch validated (${result.proposedContent.length} chars)`
        : `Patched ${relPath}`;
      if (result.proposedContent) {
        updateReadFileCache(workspace, relPath, result.proposedContent);
      }
      return { success: true, output: note };
    },
  };
}

export function createRunCommandTool(workspace: string, getMode: () => string): Tool<{ command: string }> {
  return {
    name: 'run_command',
    description: `Run a shell command in the workspace (${workspace}). Do not prefix commands with cd; the tool already runs there. Read-only commands (grep, rg, depcheck, npm ls) work in Plan mode.`,
    risk: 'high',
    inputSchema: z.object({ command: z.string() }),
    async execute(input): Promise<ToolResult> {
      if (isDangerousCommand(input.command)) {
        return { success: false, output: '', error: 'Dangerous command blocked' };
      }
      const mode = getMode();
      if (mode !== 'agent' && !isReadOnlyCommand(input.command)) {
        return {
          success: false,
          output: '',
          error: 'Only read-only inspection commands are allowed in Ask/Plan/Review mode',
        };
      }
      try {
        const normalized = normalizeWorkspaceCommand(input.command, workspace);
        if (normalized.error) {
          return { success: false, output: '', error: normalized.error };
        }
        const { stdout, stderr } = await execAsync(normalized.command, {
          cwd: normalized.cwd,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 120000,
          env: { ...process.env, FORCE_COLOR: '0' },
        });
        const output = [normalized.note, stdout, stderr].filter(Boolean).join('\n').slice(0, 50000);
        log.info('Command executed', { command: normalized.command.slice(0, 80), cwd: normalized.cwd });
        return { success: true, output: output || '(no output)' };
      } catch (e) {
        const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
        const output = [err.stdout, err.stderr].filter(Boolean).join('\n').slice(0, 50000);
        if (isBenignNonZeroExit(input.command, err.code)) {
          log.info('Command exit 1 treated as success (no matches / empty result)', {
            command: input.command.slice(0, 80),
            code: err.code,
          });
          return { success: true, output: output || '(no matches)' };
        }
        return { success: false, output, error: err.message ?? 'Command failed' };
      }
    },
  };
}

function isBenignNonZeroExit(command: string, code?: number): boolean {
  if (code !== 1) return false;
  const cmd = stripLeadingCd(command).trim();
  if (/^(grep|rg|ag|ack|find)\b/i.test(cmd)) return true;
  if (/^(npx\s+(--yes\s+)?)?depcheck\b/i.test(cmd)) return true;
  if (/^(npx\s+(--yes\s+)?)?knip\b/i.test(cmd)) return true;
  return false;
}

function normalizeWorkspaceCommand(
  command: string,
  workspace: string
): { command: string; cwd: string; note?: string; error?: string } {
  const root = normalizeWorkspaceRoot(workspace);
  if (!root) {
    return { command, cwd: workspace, error: `${AGENT_NAME} workspace path is not set.` };
  }

  const match = command.trim().match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;|]+))\s*&&\s*([\s\S]+)$/i);
  if (!match) {
    return { command: command.trim(), cwd: root };
  }

  const requested = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  const rest = match[4].trim();
  if (!rest) {
    return { command: rest, cwd: root, error: 'Command is empty after cd.' };
  }

  const target = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const rel = relative(root, target).replace(/\\/g, '/');
  const insideWorkspace = !rel.startsWith('..') && rel !== '..';

  if (!insideWorkspace) {
    if (isAbsolute(requested) && !pathExists(target)) {
      return {
        command: rest,
        cwd: root,
        note: `Ignored missing cd target ${requested}; ran in ${AGENT_NAME} workspace ${root}.`,
      };
    }
    return {
      command: rest,
      cwd: root,
      error: `Refusing to run command outside the ${AGENT_NAME} workspace: ${requested}`,
    };
  }

  if (!pathExists(target)) {
    return {
      command: rest,
      cwd: root,
      note: `Ignored missing cd target ${requested}; ran in ${AGENT_NAME} workspace ${root}.`,
    };
  }

  return { command: rest, cwd: target };
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export function createSpawnResearchAgentTool(): Tool<{
  task: string;
  focus?: string;
  targetFiles?: string[];
  chunkSize?: number;
  persona_instructions?: string;
}> {
  return {
    name: 'spawn_research_agent',
    description:
      'Delegate focused read-only research to a subagent. NOT for dependency audits — use execute_workspace_script (audit-dependencies.mjs) instead. For many files, pass targetFiles for parallel chunks.',
    risk: 'low',
    inputSchema: z.object({
      task: z.string(),
      focus: z.string().optional(),
      targetFiles: z.array(z.string()).optional(),
      chunkSize: z.number().int().min(5).max(10).optional(),
      persona_instructions: z.string().optional(),
    }),
    async execute(input): Promise<ToolResult> {
      return runSubagentTool({
        type: 'research',
        task: input.task,
        focus: input.focus,
        targetFiles: input.targetFiles,
        chunkSize: input.chunkSize,
        personaInstructions: input.persona_instructions,
      });
    },
  };
}

export function createSpawnSubagentTool(): Tool<{
  type: string;
  task: string;
  focus?: string;
  targetFiles?: string[];
  scopeRoot?: string;
  commands?: string[];
  chunkSize?: number;
  persona_instructions?: string;
}> {
  return {
    name: 'spawn_subagent',
    description:
      'Delegate scoped work to a typed subagent: research, implementer, reviewer, verifier, or a workspace custom agent from .mitii/agents. Implementer requires targetFiles or scopeRoot.',
    risk: 'medium',
    inputSchema: z.object({
      type: z.string(),
      task: z.string(),
      focus: z.string().optional(),
      targetFiles: z.array(z.string()).optional(),
      scopeRoot: z.string().optional(),
      commands: z.array(z.string()).optional(),
      chunkSize: z.number().int().min(1).max(10).optional(),
      persona_instructions: z.string().optional(),
    }),
    async execute(input): Promise<ToolResult> {
      return runSubagentTool({
        type: input.type,
        task: input.task,
        focus: input.focus,
        targetFiles: input.targetFiles,
        scopeRoot: input.scopeRoot,
        commands: input.commands,
        chunkSize: input.chunkSize,
        personaInstructions: input.persona_instructions,
      });
    },
  };
}

async function runSubagentTool(input: {
  type: string;
  task: string;
  focus?: string;
  targetFiles?: string[];
  scopeRoot?: string;
  commands?: string[];
  chunkSize?: number;
  personaInstructions?: string;
}): Promise<ToolResult> {
  const combinedTask = [input.task, input.focus, input.personaInstructions].filter(Boolean).join('\n');
  if ((input.type === 'research' || input.type === 'reviewer') && isAuditSubagentBlocked(combinedTask)) {
    log.warn('Blocked audit subagent', { task: input.task.slice(0, 120), type: input.type });
    return { success: true, output: buildScriptFirstAuditMessage(input.task) };
  }

  if (!subagentRuntime) {
    return { success: false, output: '', error: 'Subagent runtime not configured' };
  }
  const enabled = new Set(subagentRuntime.enabledTypes ?? ['research']);
  if (!enabled.has(input.type)) {
    return { success: false, output: '', error: `Subagent type ${input.type} is disabled by policy` };
  }
  const maxConcurrent = Math.max(1, subagentRuntime.maxConcurrent ?? 2);
  if (activeSubagents >= maxConcurrent) {
    return { success: false, output: '', error: `Subagent concurrency limit reached (${maxConcurrent})` };
  }
  const provider = subagentRuntime.getProvider();
  if (!provider) {
    return { success: false, output: '', error: 'No LLM provider available' };
  }

  const registry = createDefaultSubagentRegistry(
    subagentRuntime.workspace ? loadWorkspaceAgents(subagentRuntime.workspace).agents : []
  );
  const definition = registry.get(input.type);
  if (!definition) {
    return { success: false, output: '', error: `Unknown subagent type: ${input.type}` };
  }
  const effectiveDefinition = {
    ...definition,
    maxSteps: input.type === 'research' && subagentRuntime.maxSteps ? subagentRuntime.maxSteps : definition.maxSteps,
    timeoutMs: input.type === 'research' && subagentRuntime.timeoutMs ? subagentRuntime.timeoutMs : definition.timeoutMs,
  };

  const runId = subagentTracker?.start(input.task, input.focus, {
    type: input.type,
    scope: input.scopeRoot ?? input.targetFiles?.slice(0, 6).join(', '),
  });
  activeSubagents += 1;
  try {
    const subagent = new BaseSubagent(effectiveDefinition, subagentRuntime.toolExecutor);
    const targetFiles = input.targetFiles ?? [];
    let report: string;
    if (input.type === 'research' && targetFiles.length > 10) {
      const chunkSize = input.chunkSize ?? 8;
      const chunks = chunkArray(targetFiles, chunkSize);
      const reports = await Promise.all(chunks.map((chunk, index) =>
        subagent.run(provider, {
          task: `${input.task}\n\nTarget file chunk ${index + 1}/${chunks.length}`,
          focus: input.focus,
          targetFiles: chunk,
          personaInstructions: input.personaInstructions,
        }, subagentRuntime!.getTools())
      ));
      report = reports.map((r, i) => `## Chunk ${i + 1}\n${r}`).join('\n\n');
    } else {
      report = await subagent.run(provider, {
        task: input.task,
        focus: input.focus,
        targetFiles,
        scopeRoot: input.scopeRoot,
        commands: input.commands,
        personaInstructions: input.personaInstructions,
      }, subagentRuntime.getTools());
    }
    if (runId) subagentTracker?.finish(runId, report, { progress: 100 });
    return { success: true, output: report };
  } catch (e) {
    const err = String(e);
    if (runId) subagentTracker?.fail(runId, err);
    return { success: false, output: '', error: err };
  } finally {
    activeSubagents -= 1;
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_CHARS = 50_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function createFetchWebTool(allowNetwork: () => boolean): Tool<{
  url: string;
  prompt?: string;
}> {
  return {
    name: 'fetch_web',
    description:
      'Fetch content from a URL for documentation, API research, or debugging. Returns page text (HTML stripped). Use for retrieving docs when local context is insufficient.',
    risk: 'low',
    inputSchema: z.object({
      url: z.string().url(),
      prompt: z.string().optional(),
    }),
    async execute(input): Promise<ToolResult> {
      if (!allowNetwork()) {
        return { success: false, output: '', error: `Network access disabled in ${AGENT_NAME} settings` };
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const response = await fetch(input.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mitii-AI-Agent/0.1', Accept: 'text/html,application/json,text/plain,*/*' },
        });
        clearTimeout(timer);

        if (!response.ok) {
          return { success: false, output: '', error: `HTTP ${response.status}: ${response.statusText}` };
        }

        const contentType = response.headers.get('content-type') ?? '';
        let body = await response.text();
        if (body.length > MAX_FETCH_CHARS) {
          body = body.slice(0, MAX_FETCH_CHARS) + '\n...(truncated)';
        }

        const text = contentType.includes('html') ? htmlToText(body) : body;
        const promptNote = input.prompt ? `\n\nExtract focus: ${input.prompt}` : '';
        return { success: true, output: `URL: ${input.url}\n${text}${promptNote}` };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/** ask_question is intercepted by ToolExecutor — this stub should never run directly. */
export function createAskQuestionTool(): Tool<{
  question: string;
  options: string[];
}> {
  return {
    name: 'ask_question',
    description:
      'Ask the user ONE clarifying question with 2-5 selectable options. Use when a key implementation decision is ambiguous — reduces wrong-direction work. Never include an option to switch modes.',
    risk: 'low',
    inputSchema: z.object({
      question: z.string().min(10),
      options: z.array(z.string()).min(2).max(5),
    }),
    async execute(input): Promise<ToolResult> {
      return {
        success: true,
        output: `Question pending user response: ${input.question}\nOptions: ${input.options.join(' | ')}`,
      };
    },
  };
}

export function formatToolResult(toolName: string, result: ToolResult): string {
  if (!result.success) {
    return `Tool ${toolName} failed: ${result.error}`;
  }
  return `Tool ${toolName} result:\n${result.output}`;
}
