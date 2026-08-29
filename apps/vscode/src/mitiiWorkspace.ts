import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const MITII_DIR = '.mitii';

const SUBDIRS = [
  'logs',
  'checkpoints',
  'verification',
  'plans',
  'tasks',
  'skills',
  'rules',
  'diff-preview',
  'audit',
] as const;

const MCP_TEMPLATE = {
  enabled: false,
  servers: [],
} as const;

const README = `# Mitii workspace (.mitii)

Local runtime data for this workspace. Safe to gitignore.

| Path | Purpose |
|------|---------|
| \`logs/\` | Session JSONL logs (+ optional \`*-model-io.jsonl\` when developer model I/O logging is on) |
| \`checkpoints/\` | Saved run checkpoints |
| \`verification/\` | Durable before/after verification records for retry |
| \`plans/\` | Timestamped plan artifacts (\`MM-DD-YYYY-HH-MM-id-slug.json\`) |
| \`tasks/\` | Live Agent task lists (\`threadId.md\`) |
| \`skills/\` | Workspace skill playbooks |
| \`rules/\` | Project methodology rules |
| \`diff-preview/\` | Temporary diff preview files |
| \`audit/\` | Audit pack + shareable diagnostic exports |
| \`mcp.json\` | MCP install list (off by default; add from Settings store) |
| \`profiles.json\` | Local model/provider profiles with secret fingerprints only |
| \`last-repository-state.json\` | Last published index descriptor |
| \`MITTII.local.md\` | Optional personal instructions (see \`.example\`) |
`;

const LOCAL_RULES_EXAMPLE = `# Local Mitii Instructions

Personal notes for this workspace (not for git).

- Preferred verification command:
- Local services or ports:
- Project-specific cautions:
`;

const DEFAULT_GITIGNORE_ENTRIES = [
  '.mitii/',
  '.mitii-session-export.json',
  '.mitii-audit-pack.json',
] as const;

export function mitiiDir(workspaceRoot: string): string {
  return join(workspaceRoot, MITII_DIR);
}

export function mitiiLogsDir(workspaceRoot: string): string {
  return join(mitiiDir(workspaceRoot), 'logs');
}

export function mitiiAuditDir(workspaceRoot: string): string {
  return join(mitiiDir(workspaceRoot), 'audit');
}

export function mitiiPlansDir(workspaceRoot: string): string {
  return join(mitiiDir(workspaceRoot), 'plans');
}

export function mitiiTasksDir(workspaceRoot: string): string {
  return join(mitiiDir(workspaceRoot), 'tasks');
}

/**
 * Idempotent scaffold for the workspace \`.mitii\` tree.
 * Creates folders + starter files expected by the host (logs, mcp, rules, …).
 */
export function scaffoldMitiiWorkspace(workspaceRoot: string): string {
  if (!workspaceRoot.trim()) {
    throw new Error('workspaceRoot is required');
  }

  const dir = mitiiDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });

  for (const name of SUBDIRS) {
    mkdirSync(join(dir, name), { recursive: true });
  }

  const mcpPath = join(dir, 'mcp.json');
  if (!existsSync(mcpPath)) {
    writeFileSync(mcpPath, `${JSON.stringify(MCP_TEMPLATE, null, 2)}\n`, 'utf8');
  }

  const readmePath = join(dir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, README, 'utf8');
  }

  const localExample = join(dir, 'MITTII.local.md.example');
  if (!existsSync(localExample)) {
    writeFileSync(localExample, LOCAL_RULES_EXAMPLE, 'utf8');
  }

  ensureGitignoreEntries(workspaceRoot);
  return dir;
}

function ensureGitignoreEntries(workspaceRoot: string): void {
  const path = join(workspaceRoot, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const missing = DEFAULT_GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
  if (missing.length === 0) return;

  const prefix = existing.trimEnd();
  const block = ['# Mitii local runtime data', ...missing].join('\n');
  const next = prefix ? `${prefix}\n\n${block}\n` : `${block}\n`;
  writeFileSync(path, next, 'utf8');
}
