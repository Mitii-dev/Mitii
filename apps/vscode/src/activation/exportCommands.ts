import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';
import {
  findLatestSessionLog,
  formatMitiiLogStamp,
  writeSessionExport,
  writeShareableDiagnostic,
} from '@mitii/host';

import { resolveContextToggles } from '../contextToggles.js';
import { runAskInOutputChannel } from '../hostAsk.js';
import { mitiiLogsDir } from '../mitiiWorkspace.js';
import { readModelIoLoggingEnabled } from '../modelIoSettings.js';
import { buildAuditPack, buildSessionExport } from '../runReport.js';
import type { ActivationRuntime } from './runtime.js';

/** Session log, audit pack, and shareable-diagnostic exports. */
export function registerExportCommands(
  rt: ActivationRuntime,
): vscode.Disposable[] {
  const { context, channel } = rt;
  const workspaceRoot = (): string | undefined => rt.workspaceRoot();
  const ensureClient = (): Promise<MitiiClient> => rt.ensureClient();

  const exportSession = async (): Promise<string | undefined> => {
    const prompt = await vscode.window.showInputBox({
      prompt: 'Prompt to run before exporting session log',
      value: 'Summarize the current workspace briefly.',
    });
    if (!prompt?.trim()) return undefined;
    const root = workspaceRoot();
    const c = await ensureClient();
    const outcome = await runAskInOutputChannel({
      vs: vscode,
      client: c,
      prompt: prompt.trim(),
      workspaceRoot: root,
      channel,
      workspaceId: rt.workspaceId(),
      workspaceState: context.workspaceState,
      secrets: context.secrets,
    });
    const payload = buildSessionExport({
      result: outcome.result,
      events: outcome.events,
    });
    const outPath = writeSessionExport(
      root,
      context.globalStorageUri.fsPath,
      payload,
    );
    rt.lastSessionExportPath = outPath;
    channel.appendLine(`[export] wrote ${outPath}`);
    void vscode.window.showInformationMessage(`Exported session to ${outPath}`);
    return outPath;
  };

  const exportAudit = async (): Promise<void> => {
    const prompt = await vscode.window.showInputBox({
      prompt: 'Prompt to run before exporting audit pack',
      value: 'Summarize recent agent activity for audit.',
    });
    if (!prompt?.trim()) return;
    const root = workspaceRoot();
    const c = await ensureClient();
    const outcome = await runAskInOutputChannel({
      vs: vscode,
      client: c,
      prompt: prompt.trim(),
      workspaceRoot: root,
      channel,
      workspaceId: rt.workspaceId(),
      workspaceState: context.workspaceState,
      secrets: context.secrets,
    });
    const cfg = vscode.workspace.getConfiguration('mitii');
    const settingsRedacted = {
      provider: {
        type: cfg.get('provider.type'),
        baseUrl: cfg.get('provider.baseUrl'),
        model: cfg.get('provider.model'),
        hasApiKey: Boolean(await context.secrets.get('mitii.provider.apiKey')),
      },
      ui: {
        showReasoning: cfg.get('ui.showReasoning'),
        depth: cfg.get('ui.depth'),
        contextToggles: resolveContextToggles(cfg),
      },
      safety: { approvalMode: cfg.get('safety.approvalMode') },
      mcpEnabled: Boolean(
        (cfg.get('mcp') as { enabled?: boolean } | undefined)?.enabled,
      ),
    };
    const indexMeta = rt.sidebar
      ? await rt.sidebar.readIndexStatusPublic()
      : undefined;
    const payload = buildAuditPack({
      result: outcome.result,
      events: outcome.events,
      settingsRedacted,
      indexMeta: indexMeta as unknown as Record<string, unknown>,
      workspaceRoot: root,
    });
    const auditDir = root
      ? mitiiLogsDir(root)
      : context.globalStorageUri.fsPath;
    mkdirSync(auditDir, { recursive: true });
    const outPath = join(auditDir, `audit-pack-${formatMitiiLogStamp()}.json`);
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    channel.appendLine(`[audit] wrote ${outPath}`);
    void vscode.window.showInformationMessage(`Exported audit pack to ${outPath}`);
  };

  const exportShareableDiagnostic = async (): Promise<void> => {
    const root = workspaceRoot();
    const cfg = vscode.workspace.getConfiguration('mitii');
    const written = writeShareableDiagnostic({
      workspaceRoot: root,
      fallbackDir: context.globalStorageUri.fsPath,
      meta: {
        providerType: cfg.get<string>('provider.type') ?? undefined,
        model: cfg.get<string>('provider.model') ?? undefined,
        baseUrl: cfg.get<string>('provider.baseUrl') ?? undefined,
        developerEnabled: cfg.get<boolean>('developer.enabled') ?? false,
        modelIoEnabled: readModelIoLoggingEnabled(cfg),
        contextWindowTokens: (() => {
          const raw = cfg.get<number>('provider.contextWindow');
          return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
            ? Math.floor(raw)
            : undefined;
        })(),
      },
    });
    channel.appendLine(`[shareable] wrote ${written.path}`);
    if (written.sources.sessionLogPath) {
      channel.appendLine(`[shareable] session ${written.sources.sessionLogPath}`);
    }
    if (written.sources.modelIoLogPath) {
      channel.appendLine(`[shareable] model-io ${written.sources.modelIoLogPath}`);
    }
    const doc = await vscode.workspace.openTextDocument(written.path);
    await vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage(
      `Shareable diagnostic ready — copy from ${written.path}`,
    );
  };

  const openSessionLog = async (): Promise<void> => {
    const root = workspaceRoot();
    const candidate =
      rt.lastSessionExportPath ??
      findLatestSessionLog(root) ??
      (root ? join(root, '.mitii-session-export.json') : undefined);
    if (!candidate || !existsSync(candidate)) {
      const created = await exportSession();
      if (!created) return;
      const doc = await vscode.workspace.openTextDocument(created);
      await vscode.window.showTextDocument(doc);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(candidate);
    await vscode.window.showTextDocument(doc);
  };

  return [
    vscode.commands.registerCommand('mitii.exportSessionLog', async () => {
      await exportSession();
    }),
    vscode.commands.registerCommand('mitii.exportAuditPack', exportAudit),
    vscode.commands.registerCommand(
      'mitii.exportShareableDiagnostic',
      exportShareableDiagnostic,
    ),
    vscode.commands.registerCommand('mitii.openSessionLog', openSessionLog),
  ];
}
