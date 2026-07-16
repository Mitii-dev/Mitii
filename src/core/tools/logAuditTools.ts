/** Built-in tools for the log_audit route — deterministic parse + capped query. */

import { z } from 'zod';
import { existsSync, readdirSync, statSync } from 'fs';
import { isAbsolute, join, relative } from 'path';
import type { Tool, ToolResult } from './types';
import type { IgnoreService } from '../indexing/IgnoreService';
import { normalizeWorkspaceRoot, resolveWorkspaceRelPath } from '../util/paths';
import { analyzeJsonlFile, analyzeLogDirectory, queryLogEvents } from '../runtime/logAudit';

const MAX_REPORT_CHARS = 14_000;
const MAX_DIRECTORY_REPORT_CHARS = 24_000;

export function createAnalyzeJsonlTool(
  workspace: string,
  ignoreService: IgnoreService
): Tool<{
  path: string;
  includeEvidence?: boolean;
  maxEvidencePerCategory?: number;
}> {
  return {
    name: 'analyze_jsonl',
    description:
      'Deterministically parse a JSONL / Mitii session log into a compact evidence packet (counts, tokens, tools, anomalies). Never loads the raw log into model context. Prefer this over read_file for .jsonl analysis.',
    risk: 'low',
    inputSchema: z.object({
      path: z.string().min(1),
      includeEvidence: z.boolean().optional(),
      maxEvidencePerCategory: z.number().int().positive().max(50).optional(),
    }),
    parametersJsonSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative or absolute path to a .jsonl / .json / .log file.',
        },
        includeEvidence: {
          type: 'boolean',
          description: 'Include compact evidence samples (default true).',
        },
        maxEvidencePerCategory: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Max evidence items per category (default 20).',
        },
      },
      required: ['path'],
    },
    async execute(input): Promise<ToolResult> {
      const resolved = resolveLogPath(workspace, input.path, ignoreService);
      if (!resolved.ok) {
        return { success: false, output: '', error: resolved.error };
      }

      try {
        const report = await analyzeJsonlFile(resolved.absolutePath, resolved.displayPath, {
          includeEvidence: input.includeEvidence,
          maxEvidencePerCategory: input.maxEvidencePerCategory,
        });
        const output = JSON.stringify(report, null, 2);
        const note = report.hasEnoughEvidence
          ? '\n\n[hasEnoughEvidence=true] Synthesize the final analysis now. Do not re-read the log.'
          : '\n\n[hasEnoughEvidence=false] You may call query_log_events once for a narrow follow-up.';
        return {
          success: true,
          output: `${output.slice(0, MAX_REPORT_CHARS)}${note}`,
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createQueryLogEventsTool(
  workspace: string,
  ignoreService: IgnoreService
): Tool<{
  path: string;
  filter?: {
    type?: string[];
    tool?: string;
    success?: boolean;
  };
  fields?: string[];
  limit?: number;
  maxChars?: number;
}> {
  return {
    name: 'query_log_events',
    description:
      'Query filtered events from a JSONL session log. Hard-capped (default limit 30, maxChars 8000). Use at most once after deterministic log analysis for a targeted drill-down.',
    risk: 'low',
    inputSchema: z.object({
      path: z.string().min(1),
      filter: z.object({
        type: z.array(z.string()).optional(),
        tool: z.string().optional(),
        success: z.boolean().optional(),
      }).optional(),
      fields: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(100).optional(),
      maxChars: z.number().int().positive().max(24000).optional(),
    }),
    parametersJsonSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative or absolute JSONL path.' },
        filter: {
          type: 'object',
          properties: {
            type: {
              type: 'array',
              items: { type: 'string' },
              description: 'Event types e.g. tool_end, error, token_usage.',
            },
            tool: { type: 'string', description: 'Tool name filter e.g. read_file.' },
            success: { type: 'boolean' },
          },
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to include: line, time, type, message, data.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max events to return (default 30).' },
        maxChars: { type: 'integer', minimum: 500, maximum: 24000, description: 'Max response characters (default 8000).' },
      },
      required: ['path'],
    },
    async execute(input): Promise<ToolResult> {
      const resolved = resolveLogPath(workspace, input.path, ignoreService);
      if (!resolved.ok) {
        return { success: false, output: '', error: resolved.error };
      }

      try {
        const result = await queryLogEvents(resolved.absolutePath, resolved.displayPath, {
          filter: input.filter,
          fields: input.fields,
          limit: input.limit,
          maxChars: input.maxChars,
        });
        return {
          success: true,
          output: JSON.stringify(result, null, 2),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createAnalyzeLogDirectoryTool(
  workspace: string,
  ignoreService: IgnoreService,
  getActiveLogPath?: () => string
): Tool<{
  path?: string;
  includeActive?: boolean;
  includeIncomplete?: boolean;
}> {
  return {
    name: 'analyze_log_directory',
    description:
      'Deterministically analyze every Mitii JSONL session log in a directory in one call. Lists logs, marks/excludes active or incomplete files, aggregates totals, tokens, failures, duplicates, error categories, ranked anomalies, and inclusion reasons.',
    risk: 'low',
    inputSchema: z.object({
      path: z.string().min(1).optional(),
      includeActive: z.boolean().optional(),
      includeIncomplete: z.boolean().optional(),
    }),
    parametersJsonSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative or absolute log directory. Defaults to .mitii/logs/.',
        },
        includeActive: {
          type: 'boolean',
          description: 'Include active session logs in aggregate totals (default false).',
        },
        includeIncomplete: {
          type: 'boolean',
          description: 'Include incomplete/truncated logs in aggregate totals (default false).',
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      const resolved = resolveLogDirectory(workspace, input.path ?? '.mitii/logs', ignoreService);
      if (!resolved.ok) {
        return { success: false, output: '', error: resolved.error };
      }

      try {
        const report = await analyzeLogDirectory(resolved.absolutePath, resolved.displayPath, {
          includeActive: input.includeActive,
          includeIncomplete: input.includeIncomplete,
          activeLogPath: getActiveLogPath?.(),
        });
        const output = JSON.stringify(report, null, 2);
        const truncated = output.length > MAX_DIRECTORY_REPORT_CHARS;
        const note = report.hasEnoughEvidence
          ? '\n\n[hasEnoughEvidence=true] Directory analysis is complete. Synthesize the final analysis now. Do not list or re-read logs.'
          : '\n\n[hasEnoughEvidence=false] No JSONL logs were found in this directory.';
        return {
          success: true,
          output: `${output.slice(0, MAX_DIRECTORY_REPORT_CHARS)}${truncated ? '\n...[directory report truncated by character cap]' : ''}${note}`,
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createListLogsTool(workspace: string): Tool<{ limit?: number }> {
  return {
    name: 'list_logs',
    description:
      'List recent Mitii session logs under .mitii/logs/. Use when the user asks to analyze a log but did not name a file.',
    risk: 'low',
    inputSchema: z.object({
      limit: z.number().int().positive().max(50).optional(),
    }),
    parametersJsonSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max log files to list (default 15).' },
      },
    },
    async execute(input): Promise<ToolResult> {
      const root = normalizeWorkspaceRoot(workspace);
      if (!root) {
        return { success: false, output: '', error: 'Workspace path is not set.' };
      }
      const dir = join(root, '.mitii', 'logs');
      if (!existsSync(dir)) {
        return { success: true, output: JSON.stringify({ logs: [], note: 'No .mitii/logs directory yet.' }, null, 2) };
      }

      const limit = input.limit ?? 15;
      const entries = readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => {
          const abs = join(dir, name);
          const st = statSync(abs);
          return {
            path: `.mitii/logs/${name}`,
            bytes: st.size,
            mtimeMs: st.mtimeMs,
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, limit);

      return {
        success: true,
        output: JSON.stringify({ logs: entries }, null, 2),
      };
    },
  };
}

function resolveLogPath(
  workspace: string,
  rawPath: string,
  ignoreService: IgnoreService
): { ok: true; absolutePath: string; displayPath: string } | { ok: false; error: string } {
  const root = normalizeWorkspaceRoot(workspace);
  if (!root) {
    return { ok: false, error: 'Workspace path is not set.' };
  }

  let rel = resolveWorkspaceRelPath(root, rawPath);
  let absolute = rel ? join(root, rel) : undefined;

  // Allow absolute paths that resolve inside the workspace
  if (!absolute && isAbsolute(rawPath)) {
    const candidateRel = relative(root, rawPath).replace(/\\/g, '/');
    if (!candidateRel.startsWith('..') && candidateRel !== '..') {
      rel = candidateRel;
      absolute = join(root, rel);
    }
  }

  if (!rel || !absolute) {
    return { ok: false, error: `Path is outside the workspace or could not be resolved: ${rawPath}` };
  }

  if (ignoreService.isIgnored(rel, { forRead: true }) && !isAllowedLogAuditPath(rel)) {
    return { ok: false, error: `Path is ignored: ${rel}` };
  }

  if (!existsSync(absolute)) {
    return { ok: false, error: `File not found: ${rel}` };
  }

  try {
    if (!statSync(absolute).isFile()) {
      return { ok: false, error: `Not a file: ${rel}` };
    }
  } catch {
    return { ok: false, error: `Cannot stat: ${rel}` };
  }

  return { ok: true, absolutePath: absolute, displayPath: rel };
}

function resolveLogDirectory(
  workspace: string,
  rawPath: string,
  ignoreService: IgnoreService
): { ok: true; absolutePath: string; displayPath: string } | { ok: false; error: string } {
  const root = normalizeWorkspaceRoot(workspace);
  if (!root) {
    return { ok: false, error: 'Workspace path is not set.' };
  }

  let rel = resolveWorkspaceRelPath(root, rawPath);
  let absolute = rel ? join(root, rel) : undefined;

  if (!absolute && isAbsolute(rawPath)) {
    const candidateRel = relative(root, rawPath).replace(/\\/g, '/');
    if (!candidateRel.startsWith('..') && candidateRel !== '..') {
      rel = candidateRel;
      absolute = join(root, rel);
    }
  }

  if (!rel || !absolute) {
    return { ok: false, error: `Path is outside the workspace or could not be resolved: ${rawPath}` };
  }

  if (ignoreService.isIgnored(rel, { forRead: true }) && !isAllowedLogAuditDirectory(rel)) {
    return { ok: false, error: `Path is ignored: ${rel}` };
  }

  if (!existsSync(absolute)) {
    return { ok: false, error: `Directory not found: ${rel}` };
  }

  try {
    if (!statSync(absolute).isDirectory()) {
      return { ok: false, error: `Not a directory: ${rel}` };
    }
  } catch {
    return { ok: false, error: `Cannot stat: ${rel}` };
  }

  return { ok: true, absolutePath: absolute, displayPath: rel.replace(/\/?$/, '/') };
}

function isAllowedLogAuditPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return /^\.mitii\/logs\/[^/]+\.(?:jsonl|json|log)$/i.test(normalized) ||
    /^logs\/[^/]+\.(?:jsonl|json|log)$/i.test(normalized);
}

function isAllowedLogAuditDirectory(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return normalized === '.mitii/logs' || normalized === 'logs';
}
