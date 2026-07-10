import { existsSync, readFileSync, readdirSync } from 'fs';
import { extname, join } from 'path';
import { z } from 'zod';
import type { SubagentDefinition } from './types';

const AgentSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  displayName: z.string().optional(),
  tools: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
  timeoutMs: z.number().int().min(10_000).max(600_000).optional(),
  writable: z.boolean().optional(),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  requiresScope: z.boolean().optional(),
  systemPrompt: z.string().optional(),
});

export interface WorkspaceAgentLoadResult {
  agents: SubagentDefinition[];
  warnings: string[];
}

export function loadWorkspaceAgents(workspace: string): WorkspaceAgentLoadResult {
  const dir = join(workspace, '.mitii', 'agents');
  if (!existsSync(dir)) return { agents: [], warnings: [] };
  const agents: SubagentDefinition[] = [];
  const warnings: string[] = [];
  for (const file of readdirSync(dir).filter((name) => /\.(md|json|ya?ml)$/i.test(name))) {
    const path = join(dir, file);
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = extname(file) === '.json' ? JSON.parse(raw) : parseMarkdownAgent(raw);
      const validated = AgentSchema.parse(parsed);
      const prompt = validated.systemPrompt ?? parsed.body ?? '';
      if (!prompt.trim()) throw new Error('Agent prompt/body is required');
      agents.push({
        id: validated.id,
        displayName: validated.displayName ?? titleize(validated.id),
        allowedTools: validated.allowedTools ?? validated.tools ?? ['read_file', 'read_files', 'search', 'search_batch', 'git_diff', 'diagnostics'],
        deniedTools: validated.deniedTools,
        systemPrompt: prompt,
        maxSteps: validated.maxSteps ?? 8,
        timeoutMs: validated.timeoutMs ?? 120_000,
        writable: validated.writable ?? false,
        risk: validated.risk ?? (validated.writable ? 'high' : 'low'),
        requiresScope: validated.requiresScope ?? validated.writable ?? false,
      });
    } catch (error) {
      warnings.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { agents, warnings };
}

function parseMarkdownAgent(raw: string): Record<string, unknown> & { body?: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { id: 'custom-agent', body: raw };
  }
  return { ...parseYamlLite(match[1] ?? ''), body: match[2] ?? '' };
}

function parseYamlLite(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    out[key] = parseYamlValue(value);
  }
  return out;
}

function parseYamlValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function titleize(id: string): string {
  return id.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
