import type { HostToWebviewMessage, WebviewToHostMessage } from './protocol';

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

export function postToHost(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

export function onHostMessage(
  handler: (message: HostToWebviewMessage) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    const data = event.data as HostToWebviewMessage;
    if (!data || typeof data !== 'object' || !('type' in data)) return;
    handler(data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
