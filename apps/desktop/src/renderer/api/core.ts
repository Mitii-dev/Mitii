/** Bridge access and health probe. */

import {
  MITII_DESKTOP_BRIDGE_KEY,
  type MitiiDesktopBridge,
} from '../../shared/bridge.js';
import {
  DesktopHealthResponseSchema,
  type DesktopHealthResponse,
} from '../../shared/protocol.js';

export function getDesktopBridge(): MitiiDesktopBridge | undefined {
  return window[MITII_DESKTOP_BRIDGE_KEY];
}

export async function fetchHealth(
  baseUrl: string,
): Promise<DesktopHealthResponse> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) throw new Error(`health_${res.status}`);
  return DesktopHealthResponseSchema.parse(await res.json());
}
