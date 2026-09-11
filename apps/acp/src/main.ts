/**
 * apps/acp — Mitii ACP-lite stdio bridge.
 *
 * Not the full Agent Client Protocol. Line-delimited JSON over stdin/stdout.
 * Decision Policy remains authority; V8 does not import ACP.
 *
 * Depends on @mitii/sdk + @mitii/host. Does not import apps/cli.
 */
import * as readline from 'node:readline';

import {
  createMitiiClient,
  EchoLlmPort,
  type AgentMode,
  type LlmPort,
  type MitiiClient,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
} from '@mitii/sdk';

interface AcpRequest {
  op: string;
  id?: string;
  prompt?: string;
  mode?: AgentMode;
}

/** Deterministic understanding for echo / smoke (mirrors CLI local port). */
class AcpUnderstandingLlmPort implements LlmPort {
  readonly id = 'acp-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'acp/local-understanding',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield {
      type: 'content_delta',
      content: JSON.stringify({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.95,
        alternatives: [],
        needsClarification: false,
        reason: 'ACP-lite local understanding (echo).',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

function createEchoClient(cwd: string): MitiiClient {
  return createMitiiClient({
    understandingLlm: new AcpUnderstandingLlmPort(),
    runLlm: new EchoLlmPort(),
    workspaceRoot: cwd,
    defaultMode: 'ask',
    defaultSessionId: 'acp_session',
    workspaceId: 'acp_workspace',
  });
}

function writeLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function parseLine(line: string): AcpRequest | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { error: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'expected_object' };
  }
  const record = parsed as Record<string, unknown>;
  const op = typeof record.op === 'string' ? record.op : '';
  if (!op) return { error: 'missing_op' };
  return {
    op,
    id: typeof record.id === 'string' ? record.id : undefined,
    prompt: typeof record.prompt === 'string' ? record.prompt : undefined,
    mode:
      record.mode === 'ask' ||
      record.mode === 'plan' ||
      record.mode === 'agent'
        ? record.mode
        : undefined,
  };
}

async function handlePrompt(
  client: MitiiClient,
  req: AcpRequest,
): Promise<void> {
  const id = req.id ?? 'anon';
  const prompt = req.prompt?.trim();
  if (!prompt) {
    writeLine({
      op: 'error',
      id,
      error: 'prompt_required',
    });
    return;
  }
  const mode = req.mode ?? 'ask';
  const run = client.start({
    prompt,
    mode,
    workspaceRoot: process.cwd(),
  });
  for await (const event of run.events) {
    writeLine({ op: 'event', id, event });
  }
  const result = await run.result;
  writeLine({ op: 'result', id, result });
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const client = createEchoClient(cwd);
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  writeLine({
    op: 'ready',
    protocol: 'mitii-acp-lite',
    version: 1,
    note: 'ACP-lite bridge; Decision Policy remains authority; V8 does not import ACP.',
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const req = parseLine(trimmed);
    if ('error' in req) {
      writeLine({ op: 'error', error: req.error });
      continue;
    }
    if (req.op === 'ping') {
      writeLine({ op: 'pong', id: req.id });
      continue;
    }
    if (req.op === 'prompt') {
      await handlePrompt(client, req);
      continue;
    }
    writeLine({
      op: 'error',
      id: req.id,
      error: 'unknown_op',
      opReceived: req.op,
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeLine({ op: 'error', error: 'fatal', message });
  process.exitCode = 1;
});
