import type * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';

import { runAskInOutputChannel } from './hostAsk.js';

/**
 * Minimal sidebar chat surface over @mitii/sdk (Phase 15).
 * Full React webview-ui remains deferred; this satisfies the host chat boundary.
 */
export class MitiiSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mitii.sidebar';

  constructor(
    private readonly vs: typeof vscode,
    private readonly ensureClient: () => Promise<MitiiClient>,
    private readonly getWorkspaceRoot: () => string | undefined,
    private readonly channel: vscode.OutputChannel,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.renderHtml();
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object') return;
      const type = (message as { type?: string }).type;
      if (type === 'ask') {
        const prompt = String((message as { prompt?: string }).prompt ?? '').trim();
        if (!prompt) return;
        try {
          const client = await this.ensureClient();
          const outcome = await runAskInOutputChannel({
            vs: this.vs,
            client,
            prompt,
            workspaceRoot: this.getWorkspaceRoot(),
            channel: this.channel,
          });
          webviewView.webview.postMessage({
            type: 'result',
            status: outcome.result.status,
            answer: outcome.result.answer ?? '',
            route: outcome.result.route ?? null,
          });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          webviewView.webview.postMessage({ type: 'error', message: text });
        }
      }
    });
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 12px; }
    h1 { font-size: 14px; margin: 0 0 8px; font-weight: 600; }
    textarea { width: 100%; box-sizing: border-box; min-height: 72px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 8px; }
    button { margin-top: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 6px 12px; cursor: pointer; }
    pre { white-space: pre-wrap; background: var(--vscode-editor-background); padding: 8px; margin-top: 12px; font-size: 12px; }
    .meta { opacity: 0.7; font-size: 11px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Mitii</h1>
  <p class="meta">SDK host chat (Phase 15). Full React UI deferred.</p>
  <textarea id="prompt" placeholder="Ask Mitii…"></textarea>
  <button id="send">Ask</button>
  <pre id="out"></pre>
  <script>
    const vscode = acquireVsCodeApi();
    const out = document.getElementById('out');
    document.getElementById('send').addEventListener('click', () => {
      const prompt = document.getElementById('prompt').value;
      out.textContent = 'Running…';
      vscode.postMessage({ type: 'ask', prompt });
    });
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'result') {
        out.textContent = (msg.answer || '') + '\\n\\n[' + msg.status + (msg.route ? ' / ' + msg.route : '') + ']';
      } else if (msg.type === 'error') {
        out.textContent = 'Error: ' + msg.message;
      }
    });
  </script>
</body>
</html>`;
  }
}
