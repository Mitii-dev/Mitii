import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { getNextCronIso, validateCronPattern } from '../cron/next.js';
import { newId } from '../paths.js';
import type { SqliteAutomationStore } from '../store/sqliteStore.js';
import type {
  AutomationAgentMode,
  AutomationAutonomyPreset,
  TriggerKind,
} from '../types.js';

export interface ParsedCronMd {
  frontmatter: Record<string, string>;
  body: string;
  title: string;
  prompt: string;
  cron?: string;
  timezone?: string;
  mode?: AutomationAgentMode;
  autonomyPreset?: AutomationAutonomyPreset;
  workspaceRoot?: string;
  timeoutSeconds?: number;
  maxParallel?: number;
  enabled: boolean;
  triggerKind: TriggerKind;
  eventType?: string;
  filtersJson?: string;
  debounceSeconds?: number;
  dedupeWindowSeconds?: number;
  cooldownSeconds?: number;
}

const MODE_SET = new Set(['ask', 'plan', 'agent']);
const AUTONOMY_SET = new Set([
  'readonly',
  'propose',
  'apply',
  'apply_and_pr',
]);

export function parseCronMarkdown(raw: string, filePath: string): ParsedCronMd {
  const { frontmatter, body } = splitFrontmatter(raw);
  const cron = frontmatter.cron?.trim() || frontmatter.schedule?.trim();
  const triggerRaw = frontmatter.trigger?.trim() || inferTrigger(filePath, cron);
  let triggerKind: TriggerKind = 'schedule';
  if (triggerRaw === 'one_off' || triggerRaw === 'one-off') {
    triggerKind = 'one_off';
  } else if (triggerRaw === 'event') {
    triggerKind = 'event';
  } else if (triggerRaw === 'manual') {
    triggerKind = 'manual';
  } else {
    triggerKind = 'schedule';
  }

  if (triggerKind === 'schedule') {
    if (!cron) {
      throw new Error('schedule specs require cron: in frontmatter');
    }
    validateCronPattern(cron);
  }

  const eventType =
    frontmatter.event?.trim() ||
    frontmatter.eventType?.trim() ||
    frontmatter.event_type?.trim();
  if (triggerKind === 'event' && !eventType) {
    throw new Error('event specs require event: in frontmatter');
  }

  const filtersJson = resolveFiltersJson(frontmatter);

  const mode = frontmatter.mode?.trim();
  if (mode && !MODE_SET.has(mode)) {
    throw new Error(`invalid mode "${mode}"`);
  }
  const autonomy =
    frontmatter.autonomyPreset?.trim() || frontmatter.autonomy?.trim();
  if (autonomy && !AUTONOMY_SET.has(autonomy)) {
    throw new Error(`invalid autonomyPreset "${autonomy}"`);
  }

  const prompt = body.trim();
  if (!prompt) {
    throw new Error('cron markdown body (prompt) is empty');
  }

  const title =
    frontmatter.name?.trim() ||
    frontmatter.title?.trim() ||
    basename(filePath).replace(/\.cron\.md$/i, '').replace(/\.md$/i, '');

  const enabledRaw = frontmatter.enabled?.trim().toLowerCase();
  const enabled = enabledRaw !== 'false' && enabledRaw !== '0';

  return {
    frontmatter,
    body,
    title,
    prompt,
    cron,
    timezone: frontmatter.timezone?.trim() || undefined,
    mode: mode as AutomationAgentMode | undefined,
    autonomyPreset: autonomy as AutomationAutonomyPreset | undefined,
    workspaceRoot: frontmatter.workspace?.trim() || frontmatter.workspaceRoot?.trim(),
    timeoutSeconds: parseOptionalInt(frontmatter.timeoutSeconds),
    maxParallel: parseOptionalInt(frontmatter.maxParallel),
    enabled,
    triggerKind,
    eventType,
    filtersJson,
    debounceSeconds: parseOptionalInt(frontmatter.debounceSeconds),
    dedupeWindowSeconds: parseOptionalInt(frontmatter.dedupeWindowSeconds),
    cooldownSeconds: parseOptionalInt(frontmatter.cooldownSeconds),
  };
}

function inferTrigger(filePath: string, cron?: string): string {
  if (/\.event\.md$/i.test(filePath)) return 'event';
  if (filePath.includes(`${join('events', '')}`) || /[/\\]events[/\\]/.test(filePath)) {
    return 'event';
  }
  if (cron) return 'schedule';
  return 'one_off';
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function resolveFiltersJson(
  frontmatter: Record<string, string>,
): string | undefined {
  if (frontmatter.filtersJson?.trim()) {
    JSON.parse(frontmatter.filtersJson); // validate
    return frontmatter.filtersJson.trim();
  }
  if (frontmatter.filters?.trim()) {
    const raw = frontmatter.filters.trim();
    if (raw.startsWith('{')) {
      JSON.parse(raw);
      return raw;
    }
  }
  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!key.startsWith('filter.')) continue;
    const path = key.slice('filter.'.length);
    if (!path) continue;
    try {
      filters[path] = JSON.parse(value) as unknown;
    } catch {
      filters[path] = value;
    }
  }
  return Object.keys(filters).length > 0 ? JSON.stringify(filters) : undefined;
}

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) {
    return { frontmatter: {}, body: trimmed };
  }
  const fmBlock = trimmed.slice(3, end).replace(/^\r?\n/, '');
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  const frontmatter: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[match[1]!] = value;
  }
  return { frontmatter, body };
}

export interface ReconcileResult {
  upserted: string[];
  removed: string[];
  invalid: Array<{ path: string; error: string }>;
}

/**
 * Scan a cron specs directory and upsert into the store.
 * Files: `*.cron.md`, `*.event.md`, or `*.md` (including `events/`).
 */
export function reconcileCronSpecsDir(
  store: SqliteAutomationStore,
  options: {
    specsDir: string;
    defaultWorkspaceRoot?: string;
  },
): ReconcileResult {
  const upserted: string[] = [];
  const removed: string[] = [];
  const invalid: Array<{ path: string; error: string }> = [];
  const seenPaths = new Set<string>();

  if (!existsSync(options.specsDir)) {
    return { upserted, removed, invalid };
  }

  const files = listCronFiles(options.specsDir);
  for (const filePath of files) {
    seenPaths.add(filePath);
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = parseCronMarkdown(raw, filePath);
      const st = statSync(filePath);
      const hash = createHash('sha256').update(raw).digest('hex');
      const workspaceRoot =
        parsed.workspaceRoot ?? options.defaultWorkspaceRoot ?? process.cwd();
      const existing = store.getSpecBySourcePath(filePath);
      const specId = existing?.specId ?? newId('spec');
      const nextRunAt =
        parsed.triggerKind === 'schedule' && parsed.cron
          ? getNextCronIso(parsed.cron, Date.now(), parsed.timezone)
          : null;
      const changed = !existing || existing.sourceHash !== hash;
      store.upsertSpec({
        specId,
        externalId: existing?.externalId ?? specId,
        sourcePath: filePath,
        triggerKind: parsed.triggerKind,
        sourceMtimeMs: st.mtimeMs,
        sourceHash: hash,
        parseStatus: 'valid',
        parseError: null,
        enabled: parsed.enabled,
        removed: false,
        title: parsed.title,
        prompt: parsed.prompt,
        workspaceRoot,
        scheduleExpr: parsed.cron ?? null,
        timezone: parsed.timezone ?? null,
        eventType: parsed.eventType ?? null,
        filtersJson: parsed.filtersJson ?? null,
        debounceSeconds: parsed.debounceSeconds ?? null,
        dedupeWindowSeconds: parsed.dedupeWindowSeconds ?? null,
        cooldownSeconds: parsed.cooldownSeconds ?? null,
        mode: parsed.mode,
        autonomyPreset: parsed.autonomyPreset,
        timeoutSeconds: parsed.timeoutSeconds ?? null,
        maxParallel: parsed.maxParallel ?? null,
        source: 'file',
        nextRunAt: changed ? nextRunAt : undefined,
        bumpRevision: changed && Boolean(existing),
      });
      upserted.push(specId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      invalid.push({ path: filePath, error: message });
      const existing = store.getSpecBySourcePath(filePath);
      if (existing) {
        store.upsertSpec({
          specId: existing.specId,
          externalId: existing.externalId,
          sourcePath: filePath,
          triggerKind: existing.triggerKind,
          parseStatus: 'invalid',
          parseError: message,
          enabled: false,
          title: existing.title,
          prompt: existing.prompt,
          workspaceRoot: existing.workspaceRoot,
          scheduleExpr: existing.scheduleExpr,
          eventType: existing.eventType,
          source: 'file',
        });
      }
    }
  }

  // Mark file-sourced specs missing from disk as removed.
  for (const spec of store.listSpecs({ includeRemoved: true })) {
    if (spec.source !== 'file') continue;
    if (seenPaths.has(spec.sourcePath)) continue;
    if (spec.removed) continue;
    // Only remove if the source path was under this specsDir
    if (!spec.sourcePath.startsWith(options.specsDir)) continue;
    store.markSpecRemoved(spec.specId);
    store.cancelQueuedRunsForSpec(spec.specId);
    removed.push(spec.specId);
  }

  return { upserted, removed, invalid };
}

function listCronFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listCronFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (
      /\.cron\.md$/i.test(entry.name) ||
      /\.event\.md$/i.test(entry.name) ||
      /\.md$/i.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}
