import { HeadlessAgentHost } from '../../../src/adapters/node/HeadlessAgentHost';
import type { ProviderType } from '../../../src/kernel/config/schema';
import type { MitiiClientOptions, MitiiEvent, MitiiQueryOptions, MitiiResult } from './types';

export class MitiiClient {
  private host?: HeadlessAgentHost;
  private initialized = false;

  constructor(private readonly options: MitiiClientOptions) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.host = new HeadlessAgentHost(toHeadlessOptions(this.options));
    await this.host.initialize();
    this.initialized = true;
  }

  async ask(prompt: string): Promise<string> {
    await this.initialize();
    return this.host!.ask(prompt);
  }

  async plan(prompt: string): Promise<Record<string, unknown>> {
    await this.initialize();
    return await this.host!.plan(prompt) as Record<string, unknown>;
  }

  async *agent(prompt: string, signal?: AbortSignal): AsyncIterable<MitiiEvent> {
    await this.initialize();
    for await (const event of this.host!.agent(prompt) as AsyncIterable<MitiiEvent>) {
      if (signal?.aborted) throw new Error('Mitii query aborted');
      yield event;
    }
  }

  async *query(options: Omit<MitiiQueryOptions, keyof MitiiClientOptions | 'prompt'> & { prompt: string }): AsyncIterable<MitiiEvent> {
    const mode = options.mode ?? 'agent';
    const started = Date.now();
    const events: MitiiEvent[] = [];
    let content = '';
    const emit = async function* (event: MitiiEvent): AsyncIterable<MitiiEvent> {
      events.push(event);
      yield event;
    };

    if (mode === 'ask') {
      content = await this.ask(options.prompt);
      yield* emit({ type: 'assistant_delta', content });
    } else if (mode === 'plan') {
      const plan = await this.plan(options.prompt);
      yield* emit({ type: 'plan', plan });
      content = JSON.stringify(plan);
    } else {
      for await (const event of this.agent(options.prompt, options.signal)) {
        if (event.type === 'assistant_delta') content += event.content;
        if (event.type === 'done') {
          content = event.content;
          continue;
        }
        yield* emit(event);
      }
    }

    yield* emit({
      type: 'metrics',
      durationMs: Date.now() - started,
      toolCalls: this.host?.getToolAudit().length ?? 0,
      sessionLogPath: this.host?.getSessionLog().getLogPath() || undefined,
      auditTools: this.host?.getToolAudit().map((entry) => entry.toolName),
    });
    yield* emit({ type: 'done', content });
  }

  async run(options: Omit<MitiiQueryOptions, keyof MitiiClientOptions | 'prompt'> & { prompt: string }): Promise<MitiiResult> {
    const events: MitiiEvent[] = [];
    let content = '';
    for await (const event of this.query(options)) {
      events.push(event);
      if (event.type === 'done') content = event.content;
    }
    return { content, events };
  }

  resolveApproval(id: string, decision: 'approved' | 'denied'): boolean {
    return this.host?.resolveApproval(id, decision) ?? false;
  }

  async dispose(): Promise<void> {
    await this.host?.dispose();
    this.host = undefined;
    this.initialized = false;
  }
}

export function createClient(options: MitiiClientOptions): MitiiClient {
  return new MitiiClient(options);
}

export async function* query(options: MitiiQueryOptions): AsyncIterable<MitiiEvent> {
  const client = createClient(options);
  try {
    yield* client.query(options);
  } finally {
    await client.dispose();
  }
}

function toHeadlessOptions(options: MitiiClientOptions): ConstructorParameters<typeof HeadlessAgentHost>[0] {
  return {
    cwd: options.cwd,
    packageRoot: options.packageRoot,
    runtime: options.runtime,
    providerType: (options.providerType ?? options.provider) as ProviderType | undefined,
    baseUrl: options.baseUrl,
    model: options.model,
    apiKey: options.apiKey,
    approval: options.approval,
    allowNetwork: options.allowNetwork,
    enablePuppeteer: options.enablePuppeteer,
    indexWorkspace: options.indexWorkspace,
    configOverrides: options.vectors === undefined
      ? undefined
      : { indexing: { vectorsEnabled: options.vectors } } as never,
  };
}
