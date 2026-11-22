import type * as vscode from 'vscode';

/** CSP-locked HTML shell that boots the bundled React webview. */
export function renderSidebarHtml(
  vs: typeof vscode,
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
): string {
  const scriptUri = webview.asWebviewUri(
    vs.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js'),
  );
  const styleUri = webview.asWebviewUri(
    vs.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.css'),
  );
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    "frame-src 'self' data: blob: https:",
    "child-src 'self' data: blob: https:",
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${styleUri}" />
<title>Mitii</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
