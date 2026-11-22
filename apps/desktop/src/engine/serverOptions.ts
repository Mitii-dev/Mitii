/** Public option / handle contracts for the desktop engine server. */

import type { MitiiClient } from '@mitii/sdk';

import type { DesktopHostMode } from '../shared/protocol.js';

export interface EngineServerOptions {
  client: MitiiClient;
  mode: DesktopHostMode;
  workspaceRoot: string;
  host?: string;
  port?: number;
  /** Optional bearer token; when set, /v1/* requires Authorization: Bearer … */
  token?: string;
}

export interface EngineServerHandle {
  url: string;
  host: string;
  port: number;
  token: string | undefined;
  close: () => Promise<void>;
}
