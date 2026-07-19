import { DaemonClient, DaemonSessionClient } from '../../../../packages/sdk/src/daemon';
import type { MitiiApprovalDecision, MitiiEvent, MitiiMode } from '../../../../packages/sdk/src/types';
import { debugTrace } from '../../../kernel/telemetry/AsyncDebugTrace';

export interface DaemonRuntimeAdapterOptions {
  cwd: string;
  daemonUrl?: string;
  daemonToken?: string;
  mode?: MitiiMode;
}

export class DaemonRuntimeAdapter {
  private readonly client: DaemonClient;
  private session?: DaemonSessionClient;

  constructor(private readonly options: DaemonRuntimeAdapterOptions) {
    this.client = new DaemonClient({
      baseUrl: options.daemonUrl ?? 'http://127.0.0.1:4310',
      token: options.daemonToken,
      trace: ({ payload, ...event }) => {
        debugTrace.trace('daemon', `${event.transport}_${event.direction}`, event, payload);
      },
    });
  }

  async connect(): Promise<void> {
    this.session = await DaemonSessionClient.createOrAttach(this.client, {
      cwd: this.options.cwd,
      mode: this.options.mode ?? 'agent',
      approval: 'manual',
    });
  }

  async sendMessage(message: string, mode: MitiiMode = this.options.mode ?? 'agent'): Promise<AsyncIterable<MitiiEvent>> {
    if (!this.session) await this.connect();
    const session = this.session!;
    const events = session.events();
    await session.prompt({ mode, message });
    return events;
  }

  approve(id: string, decision: MitiiApprovalDecision): Promise<Record<string, unknown>> {
    if (!this.session) throw new Error('Daemon session not connected');
    return this.session.respondToPermission(id, decision);
  }

  async getSubagents(): Promise<unknown[]> {
    return [];
  }

  cancel(): Promise<Record<string, unknown>> {
    if (!this.session) throw new Error('Daemon session not connected');
    return this.session.cancel();
  }
}
