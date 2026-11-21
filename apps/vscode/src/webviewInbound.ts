import {
  parseWebviewToHostMessage,
  type WebviewToHostMessage,
} from '@mitii/ui-protocol';

/** Host-side gate for untrusted webview `postMessage` payloads. */
export function acceptWebviewMessage(
  raw: unknown,
  log: (line: string) => void,
): WebviewToHostMessage | undefined {
  const parsed = parseWebviewToHostMessage(raw);
  if (parsed.ok) return parsed.value;
  const type =
    typeof raw === 'object' && raw !== null && 'type' in raw
      ? String((raw as { type: unknown }).type)
      : '(none)';
  const detail = parsed.issues
    .map((issue) => `${issue.path || '(root)'}: ${issue.message}`)
    .join('; ');
  log(
    `[webview] rejected message type=${type} reason=${parsed.reason}${
      detail ? ` (${detail})` : ''
    }`,
  );
  return undefined;
}
