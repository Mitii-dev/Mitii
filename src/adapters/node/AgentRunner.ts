import { createProvider } from '../../adapters/providers/createProvider';
import type { ProviderType } from '../../kernel/config/schema';
import type { ChatDelta, LlmProvider } from '../../kernel/llm/types';
import { getProviderPreset } from '../../kernel/llm/providerPresets';

export interface HeadlessRunnerOptions {
  cwd: string;
  providerType?: ProviderType;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  approval?: 'auto' | 'manual';
  json?: boolean;
}

export interface HeadlessPlan {
  goal: string;
  cwd: string;
  provider: string;
  model: string;
  approval: 'auto' | 'manual';
  steps: Array<{ id: string; title: string; risk: 'low' | 'medium' | 'high'; readOnly: boolean }>;
}

export class HeadlessAgentRunner {
  private readonly provider: LlmProvider;
  private readonly providerType: ProviderType;
  private readonly model: string;
  private readonly approval: 'auto' | 'manual';

  constructor(private readonly options: HeadlessRunnerOptions) {
    this.providerType = options.providerType ?? 'echo';
    const preset = getProviderPreset(this.providerType);
    this.model = options.model ?? preset?.model ?? 'echo';
    this.approval = options.approval ?? 'manual';
    this.provider = createProvider({
      type: this.providerType,
      baseUrl: options.baseUrl ?? preset?.baseUrl,
      model: this.model,
      contextWindow: preset?.contextWindow,
      supportsStreaming: true,
      supportsTools: false,
      supportsEmbeddings: false,
    }, options.apiKey ?? resolveApiKey(this.providerType));
  }

  async ask(prompt: string): Promise<string> {
    return this.complete([
      {
        role: 'system',
        content: [
          'You are Mitii headless ask mode.',
          'Answer in concise Markdown.',
          'Do not claim to have edited files or used VS Code APIs.',
        ].join('\n'),
      },
      { role: 'user', content: prompt },
    ]);
  }

  plan(prompt: string): HeadlessPlan {
    return {
      goal: prompt,
      cwd: this.options.cwd,
      provider: this.providerType,
      model: this.model,
      approval: this.approval,
      steps: [
        { id: 'discover', title: 'Inspect the repository context relevant to the request', risk: 'low', readOnly: true },
        { id: 'design', title: 'Identify files, interfaces, and tests that need changes', risk: 'low', readOnly: true },
        { id: 'execute', title: 'Apply scoped changes in the VS Code extension runtime or a future tool-enabled headless loop', risk: 'medium', readOnly: false },
        { id: 'verify', title: 'Run focused tests and summarize residual risk', risk: 'low', readOnly: true },
      ],
    };
  }

  async *agent(prompt: string): AsyncIterable<{ type: string; message?: string; plan?: HeadlessPlan; content?: string }> {
    const plan = this.plan(prompt);
    yield { type: 'plan', plan };
    const content = await this.ask([
      prompt,
      '',
      'Headless agent mode has no filesystem write tools in this runtime. Provide the best implementation guidance and verification checklist.',
    ].join('\n'));
    yield { type: 'assistant_delta', content };
    yield { type: 'done', content };
  }

  private async complete(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
    let content = '';
    for await (const delta of this.provider.complete({ messages, stream: true })) {
      content += deltaContent(delta);
    }
    return content;
  }
}

function deltaContent(delta: ChatDelta): string {
  return delta.content ?? '';
}

function resolveApiKey(providerType: ProviderType): string | undefined {
  if (providerType === 'anthropic') return process.env.ANTHROPIC_API_KEY ?? process.env.MITII_API_KEY;
  if (providerType === 'gemini') return process.env.GEMINI_API_KEY ?? process.env.MITII_API_KEY;
  if (providerType === 'openrouter') return process.env.OPENROUTER_API_KEY ?? process.env.MITII_API_KEY;
  return process.env.MITII_API_KEY ?? process.env.OPENAI_API_KEY;
}
