/**
 * Long-lived automation control plane inside the desktop engine process.
 *
 * Mirrors apps/daemon (inject executor + delivery from @mitii/host) without
 * importing apps/daemon (REPO_LAYOUT forbids app→app).
 */

import Database from 'better-sqlite3';
import { AutomationService } from '@mitii/automation';
import { createCompositeDeliverySender } from '@mitii/host';

import { createDesktopAutomationExecutor } from './executor.js';
import { drainPendingGitHookEvents } from './gitCommitHook.js';

export interface AutomationRunnerStatus {
  running: boolean;
  workspaceRoot: string | null;
  webhookUrl: string | null;
  webhookPort: number | null;
  webhookTokenSet: boolean;
  githubWebhookSecretSet: boolean;
  startedAt: string | null;
  lastError: string | null;
  /** Public hook paths for operator UI. */
  hooks: {
    health: string | null;
    events: string | null;
    github: string | null;
  };
}

export interface StartAutomationRunnerOptions {
  workspaceRoot: string;
  webhookPort?: number;
  webhookToken?: string;
  githubWebhookSecret?: string;
  pollIntervalMs?: number;
  forceEcho?: boolean;
}

type OpenDb = (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => Database.Database;

function openDatabase(
  filename: string,
  openOptions?: { readonly?: boolean; fileMustExist?: boolean },
): Database.Database {
  return new Database(filename, openOptions);
}

class DesktopAutomationRuntime {
  private service: AutomationService | null = null;
  private drainTimer: NodeJS.Timeout | null = null;
  private status: AutomationRunnerStatus = {
    running: false,
    workspaceRoot: null,
    webhookUrl: null,
    webhookPort: null,
    webhookTokenSet: false,
    githubWebhookSecretSet: false,
    startedAt: null,
    lastError: null,
    hooks: { health: null, events: null, github: null },
  };

  /**
   * Short-lived service for CRUD when the runner is not owning the connection.
   * When the runner is active, reuse the same AutomationService instance.
   */
  withService<T>(fn: (service: AutomationService) => T): T {
    if (this.service) {
      return fn(this.service);
    }
    const service = new AutomationService({
      openDatabase: openDatabase as OpenDb as never,
    });
    try {
      return fn(service);
    } finally {
      try {
        service.close();
      } catch {
        /* ignore */
      }
    }
  }

  getStatus(): AutomationRunnerStatus {
    return { ...this.status };
  }

  async start(options: StartAutomationRunnerOptions): Promise<AutomationRunnerStatus> {
    this.stop();
    const workspaceRoot = options.workspaceRoot;
    try {
      const service = new AutomationService({
        openDatabase: openDatabase as OpenDb as never,
        executor: createDesktopAutomationExecutor({
          forceEcho: options.forceEcho === true,
        }),
        deliverySender: createCompositeDeliverySender({}),
        onEvent: (event) => {
          if (event.type === 'error') {
            this.status.lastError = event.message;
          } else if (
            event.type === 'run_finished' &&
            event.status === 'failed'
          ) {
            this.status.lastError = event.error ?? 'run_failed';
          }
        },
      });
      this.service = service;
      service.start({
        workspaceRoot,
        pollIntervalMs: options.pollIntervalMs ?? 5_000,
        autoReconcile: true,
      });

      // Drain git-hook pending files on an interval alongside materialize.
      const drainMs = options.pollIntervalMs ?? 5_000;
      const drainTimer = setInterval(() => {
        if (!this.service) return;
        try {
          drainPendingGitHookEvents({
            workspaceRoot,
            ingest: (event) => this.service!.ingestEvent(event),
          });
        } catch {
          /* keep loop alive */
        }
      }, drainMs);
      drainTimer.unref?.();
      this.drainTimer = drainTimer;

      let webhookUrl: string | null = null;
      const secret =
        options.githubWebhookSecret ??
        process.env.MITII_GITHUB_WEBHOOK_SECRET ??
        undefined;
      if (options.webhookPort && options.webhookPort > 0) {
        try {
          webhookUrl = await service.startWebhook({
            port: options.webhookPort,
            token: options.webhookToken,
            githubWebhookSecret: secret,
            workspaceRoot,
          });
        } catch (error) {
          this.status.lastError =
            error instanceof Error ? error.message : String(error);
        }
      }

      const base = webhookUrl?.replace(/\/$/, '') ?? null;
      this.status = {
        running: true,
        workspaceRoot,
        webhookUrl,
        webhookPort: options.webhookPort ?? null,
        webhookTokenSet: Boolean(options.webhookToken?.trim()),
        githubWebhookSecretSet: Boolean(secret?.trim()),
        startedAt: new Date().toISOString(),
        lastError: this.status.lastError,
        hooks: {
          health: base ? `${base}/health` : null,
          events: base ? `${base}/events` : null,
          github: base ? `${base}/hooks/github` : null,
        },
      };
      return this.getStatus();
    } catch (error) {
      this.service = null;
      this.status = {
        running: false,
        workspaceRoot,
        webhookUrl: null,
        webhookPort: null,
        webhookTokenSet: false,
        githubWebhookSecretSet: false,
        startedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
        hooks: { health: null, events: null, github: null },
      };
      throw error;
    }
  }

  stop(): AutomationRunnerStatus {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    if (this.service) {
      try {
        // stop() clears claim poll + in-flight heartbeats before close()
        this.service.stop();
      } catch {
        /* ignore */
      }
      try {
        this.service.close();
      } catch {
        /* ignore */
      }
      this.service = null;
    }
    this.status = {
      running: false,
      workspaceRoot: this.status.workspaceRoot,
      webhookUrl: null,
      webhookPort: null,
      webhookTokenSet: false,
      githubWebhookSecretSet: false,
      startedAt: null,
      lastError: this.status.lastError,
      hooks: { health: null, events: null, github: null },
    };
    return this.getStatus();
  }
}

/** Process-wide singleton — one runner per engine process. */
export const desktopAutomationRuntime = new DesktopAutomationRuntime();
