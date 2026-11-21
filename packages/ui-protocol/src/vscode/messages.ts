import { parseWire, type WireParseResult } from '../parse.js';
import {
  HostToWebviewMessageSchema,
  type HostToWebviewMessage,
} from './host-to-webview.js';
import {
  WebviewToHostMessageSchema,
  type WebviewToHostMessage,
} from './webview-to-host.js';

const webviewToHostTypes: ReadonlySet<string> = new Set(
  WebviewToHostMessageSchema.options.map((option) => option.shape.type.value),
);
const hostToWebviewTypes: ReadonlySet<string> = new Set(
  HostToWebviewMessageSchema.options.map((option) => option.shape.type.value),
);

/** Host-side gate for untrusted `postMessage` payloads from the webview. */
export function parseWebviewToHostMessage(
  input: unknown,
): WireParseResult<WebviewToHostMessage> {
  return parseWire(WebviewToHostMessageSchema, input, {
    key: 'type',
    known: webviewToHostTypes,
  });
}

/** Webview-side gate for host payloads (optional; hosts are trusted). */
export function parseHostToWebviewMessage(
  input: unknown,
): WireParseResult<HostToWebviewMessage> {
  return parseWire(HostToWebviewMessageSchema, input, {
    key: 'type',
    known: hostToWebviewTypes,
  });
}

export const WEBVIEW_TO_HOST_MESSAGE_TYPES = webviewToHostTypes;
export const HOST_TO_WEBVIEW_MESSAGE_TYPES = hostToWebviewTypes;
