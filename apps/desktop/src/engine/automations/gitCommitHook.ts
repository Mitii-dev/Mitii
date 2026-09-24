/**
 * Local git post-commit hook installer for `git.commit.local` events.
 * Fallback: pending JSONL under `.mitii/hooks/pending/` when webhook is down.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';

import type { AutomationEventEnvelope } from '@mitii/automation';

const HOOK_MARKER = '# mitii-desktop-automation-hook';
const HOOK_VERSION = '1';

export interface GitCommitHookStatus {
  installed: boolean;
  path: string;
  managedByMitii: boolean;
  version: string | null;
  eventsUrl: string | null;
}

export function gitHookPaths(workspaceRoot: string): {
  hookPath: string;
  pendingDir: string;
  backupPath: string;
} {
  const hookPath = join(workspaceRoot, '.git', 'hooks', 'post-commit');
  return {
    hookPath,
    pendingDir: join(workspaceRoot, '.mitii', 'hooks', 'pending'),
    backupPath: `${hookPath}.mitii-backup`,
  };
}

export function getGitCommitHookStatus(
  workspaceRoot: string,
): GitCommitHookStatus {
  const { hookPath } = gitHookPaths(workspaceRoot);
  if (!existsSync(hookPath)) {
    return {
      installed: false,
      path: hookPath,
      managedByMitii: false,
      version: null,
      eventsUrl: null,
    };
  }
  const raw = readFileSync(hookPath, 'utf8');
  const managedByMitii = raw.includes(HOOK_MARKER);
  const versionMatch = /mitii-hook-version=(\S+)/.exec(raw);
  const urlMatch = /MITII_EVENTS_URL="([^"]*)"/.exec(raw);
  return {
    installed: true,
    path: hookPath,
    managedByMitii,
    version: versionMatch?.[1] ?? null,
    eventsUrl: urlMatch?.[1] || null,
  };
}

export function installGitCommitHook(input: {
  workspaceRoot: string;
  /** Optional live webhook /events URL while desktop runner is up. */
  eventsUrl?: string | null;
  webhookToken?: string | null;
}): GitCommitHookStatus {
  const { hookPath, pendingDir, backupPath } = gitHookPaths(
    input.workspaceRoot,
  );
  const gitHooksDir = join(input.workspaceRoot, '.git', 'hooks');
  if (!existsSync(join(input.workspaceRoot, '.git'))) {
    throw new Error('not_a_git_repository');
  }
  mkdirSync(gitHooksDir, { recursive: true });
  mkdirSync(pendingDir, { recursive: true });

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (!existing.includes(HOOK_MARKER) && !existsSync(backupPath)) {
      writeFileSync(backupPath, existing, 'utf8');
    }
  }

  const eventsUrl = (input.eventsUrl ?? '').replace(/\/$/, '');
  const token = input.webhookToken?.trim() ?? '';
  const script = `#!/bin/sh
${HOOK_MARKER}
# mitii-hook-version=${HOOK_VERSION}
# Posts git.commit.local to Mitii desktop runner, or queues a pending event file.
set -e
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MSG="$(git log -1 --pretty=%B 2>/dev/null | sed 's/"/\\\\"/g' | tr '\\n' ' ')"
SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
PENDING_DIR="$ROOT/.mitii/hooks/pending"
mkdir -p "$PENDING_DIR"
EVENT_ID="git.commit.local:$SHA:$(date +%s)"
PAYLOAD_FILE="$PENDING_DIR/$EVENT_ID.json"
cat > "$PAYLOAD_FILE" <<EOF
{"eventId":"$EVENT_ID","eventType":"git.commit.local","source":"git-hook","subject":"$ROOT","workspaceRoot":"$ROOT","occurredAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","payload":{"message":"$MSG","sha":"$SHA"}}
EOF
MITII_EVENTS_URL="${eventsUrl}"
MITII_TOKEN="${token}"
if [ -n "$MITII_EVENTS_URL" ]; then
  if command -v curl >/dev/null 2>&1; then
    HDR=(-H "content-type: application/json")
    if [ -n "$MITII_TOKEN" ]; then
      HDR+=(-H "authorization: Bearer $MITII_TOKEN")
    fi
    if curl -sS -m 3 -X POST "\${HDR[@]}" --data-binary @"$PAYLOAD_FILE" "$MITII_EVENTS_URL" >/dev/null 2>&1; then
      rm -f "$PAYLOAD_FILE"
    fi
  fi
fi
exit 0
`;
  writeFileSync(hookPath, script, 'utf8');
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    /* windows may ignore */
  }
  return getGitCommitHookStatus(input.workspaceRoot);
}

export function uninstallGitCommitHook(
  workspaceRoot: string,
): GitCommitHookStatus {
  const { hookPath, backupPath } = gitHookPaths(workspaceRoot);
  if (existsSync(hookPath)) {
    const raw = readFileSync(hookPath, 'utf8');
    if (raw.includes(HOOK_MARKER)) {
      unlinkSync(hookPath);
      if (existsSync(backupPath)) {
        renameSync(backupPath, hookPath);
        try {
          chmodSync(hookPath, 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return getGitCommitHookStatus(workspaceRoot);
}

/**
 * Drain pending hook event files into AutomationService.ingestEvent.
 */
export function drainPendingGitHookEvents(input: {
  workspaceRoot: string;
  ingest: (event: AutomationEventEnvelope) => unknown;
}): { drained: number; errors: string[] } {
  const { pendingDir } = gitHookPaths(input.workspaceRoot);
  if (!existsSync(pendingDir)) {
    return { drained: 0, errors: [] };
  }
  let drained = 0;
  const errors: string[] = [];
  for (const name of readdirSync(pendingDir)) {
    if (!name.endsWith('.json')) continue;
    const full = join(pendingDir, name);
    try {
      const raw = readFileSync(full, 'utf8');
      const event = JSON.parse(raw) as AutomationEventEnvelope;
      input.ingest(event);
      unlinkSync(full);
      drained += 1;
    } catch (error) {
      errors.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { drained, errors };
}
