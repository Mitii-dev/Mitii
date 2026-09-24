/**
 * Persist desktop automation runner prefs under workspace `.mitii/`.
 * Secrets live in a sibling secrets file (do not commit).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopRunnerPrefs {
  webhookPort: number;
  /** Non-secret flag only — token itself is in secrets file. */
  hasWebhookToken: boolean;
  hasGithubWebhookSecret: boolean;
}

export interface DesktopRunnerSecrets {
  webhookToken?: string;
  githubWebhookSecret?: string;
}

function prefsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'desktop-runner.json');
}

function secretsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'desktop-runner.secrets.json');
}

export function readDesktopRunnerPrefs(
  workspaceRoot: string,
): DesktopRunnerPrefs {
  const defaults: DesktopRunnerPrefs = {
    webhookPort: 8787,
    hasWebhookToken: false,
    hasGithubWebhookSecret: false,
  };
  const path = prefsPath(workspaceRoot);
  if (!existsSync(path)) return defaults;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<DesktopRunnerPrefs>;
    return {
      webhookPort:
        typeof raw.webhookPort === 'number' && raw.webhookPort > 0
          ? Math.floor(raw.webhookPort)
          : defaults.webhookPort,
      hasWebhookToken: Boolean(raw.hasWebhookToken),
      hasGithubWebhookSecret: Boolean(raw.hasGithubWebhookSecret),
    };
  } catch {
    return defaults;
  }
}

export function readDesktopRunnerSecrets(
  workspaceRoot: string,
): DesktopRunnerSecrets {
  const path = secretsPath(workspaceRoot);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as DesktopRunnerSecrets;
    return {
      webhookToken:
        typeof raw.webhookToken === 'string' ? raw.webhookToken : undefined,
      githubWebhookSecret:
        typeof raw.githubWebhookSecret === 'string'
          ? raw.githubWebhookSecret
          : undefined,
    };
  } catch {
    return {};
  }
}

export function writeDesktopRunnerConfig(input: {
  workspaceRoot: string;
  webhookPort: number;
  webhookToken?: string;
  githubWebhookSecret?: string;
}): DesktopRunnerPrefs {
  const mitiiDir = join(input.workspaceRoot, '.mitii');
  mkdirSync(mitiiDir, { recursive: true });
  const prefs: DesktopRunnerPrefs = {
    webhookPort: input.webhookPort > 0 ? Math.floor(input.webhookPort) : 8787,
    hasWebhookToken: Boolean(input.webhookToken?.trim()),
    hasGithubWebhookSecret: Boolean(input.githubWebhookSecret?.trim()),
  };
  writeFileSync(prefsPath(input.workspaceRoot), `${JSON.stringify(prefs, null, 2)}\n`);
  const secrets: DesktopRunnerSecrets = {
    ...(input.webhookToken?.trim()
      ? { webhookToken: input.webhookToken.trim() }
      : {}),
    ...(input.githubWebhookSecret?.trim()
      ? { githubWebhookSecret: input.githubWebhookSecret.trim() }
      : {}),
  };
  writeFileSync(
    secretsPath(input.workspaceRoot),
    `${JSON.stringify(secrets, null, 2)}\n`,
  );
  return prefs;
}
