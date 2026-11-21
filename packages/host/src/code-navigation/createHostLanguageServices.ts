import type {
  CodeNavigationCapability,
  CodeNavigationPort,
  DiagnosticsPort,
} from '@mitii/v8';
import { CODE_NAVIGATION_OPERATIONS } from '@mitii/v8';

import { createHostCodeNavigationPort } from './createHostCodeNavigationPort.js';
import { createNodeJsDiagnosticsPort } from './createNodeJsDiagnosticsPort.js';
import {
  createStdioLspCodeNavigationPort,
  type StdioLspServerConfig,
} from './createStdioLspCodeNavigationPort.js';
import { PreferStdioThenTypeScriptPort } from './preferStdioThenTypeScriptPort.js';
import { discoverStdioLspServers } from './stdio-lsp/discoverStdioLspServers.js';
import { tryCreateTypeScriptLanguageService } from './typescriptLanguageService.js';

/**
 * CLI/ACP-owned language-service lifecycle.
 *
 * V8 must not spawn servers. This host creates a TypeScript language service
 * when `tsconfig.json` exists (`available`) and otherwise leaves navigation on
 * the repo graph (`degraded`). Diagnostics are the same service so apply_patch
 * can surface new errors without a separate model call.
 */
export interface HostLanguageServices {
  codeNavigation: CodeNavigationPort;
  diagnostics?: DiagnosticsPort;
  capability: CodeNavigationCapability;
  dispose(): void;
}

export function createHostLanguageServices(options: {
  workspaceRoot: string;
  /**
   * Stdio language servers. When omitted, well-known servers on PATH are
   * discovered (pass `[]` to disable). Servers start lazily on first
   * prepare/navigate for a matching extension.
   */
  lspServers?: readonly StdioLspServerConfig[];
  abortSignal?: AbortSignal;
}): HostLanguageServices {
  const service = tryCreateTypeScriptLanguageService(options.workspaceRoot);
  const resolvedServers =
    options.lspServers ?? discoverStdioLspServers();
  const stdio =
    resolvedServers.length > 0
      ? createStdioLspCodeNavigationPort({
          workspaceRoot: options.workspaceRoot,
          servers: resolvedServers,
          abortSignal: options.abortSignal,
        })
      : undefined;

  if (service) {
    // Prefer stdio when configured for the file; fall back to in-process TS.
    const languageServer: CodeNavigationPort = stdio
      ? new PreferStdioThenTypeScriptPort(stdio, service)
      : service;
    return {
      codeNavigation: createHostCodeNavigationPort({
        workspaceRoot: options.workspaceRoot,
        languageServer,
      }),
      diagnostics: service,
      capability: service.capability(),
      dispose() {
        service.dispose();
        void stdio?.dispose();
      },
    };
  }

  if (stdio) {
    return {
      codeNavigation: createHostCodeNavigationPort({
        workspaceRoot: options.workspaceRoot,
        languageServer: stdio,
      }),
      // Stdio LSP may not expose diagnostics; Node module-load covers .js/.mjs/.cjs.
      diagnostics: createNodeJsDiagnosticsPort({
        workspaceRoot: options.workspaceRoot,
      }),
      capability: {
        status: 'available',
        provider: 'language_server',
        reason: 'stdio_lsp_configured',
        operations: CODE_NAVIGATION_OPERATIONS,
      },
      dispose() {
        void stdio.dispose();
      },
    };
  }

  const codeNavigation = createHostCodeNavigationPort({
    workspaceRoot: options.workspaceRoot,
  });
  return {
    codeNavigation,
    diagnostics: createNodeJsDiagnosticsPort({
      workspaceRoot: options.workspaceRoot,
    }),
    capability: codeNavigation.capability?.() ?? {
      status: 'degraded',
      provider: 'repo_graph',
      reason: 'language_server_not_configured',
      operations: CODE_NAVIGATION_OPERATIONS,
    },
    dispose() {},
  };
}
