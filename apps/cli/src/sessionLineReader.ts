import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import type { SessionIo } from './session.js';

/**
 * The one readline that owns stdin for an interactive session. REPL turns and
 * mid-run prompts (approvals, clarifications) all go through it, so two
 * readline instances never compete for the same input stream.
 */
export interface SessionLineReader {
  /** Resolve the next input line, or `null` once input has closed (EOF / Ctrl-C at prompt). */
  readLine(prompt: string): Promise<string | null>;
  /**
   * SessionIo whose `prompt` is served by this reader; everything else
   * (stdout/stderr/interrupt) is delegated to `base`.
   */
  createSessionIo(base: SessionIo): SessionIo;
  close(): void;
}

export function createSessionLineReader(options: {
  input?: Readable;
  output?: Writable;
  terminal?: boolean;
} = {}): SessionLineReader {
  const output = options.output ?? process.stderr;
  const rl = createInterface({
    input: options.input ?? process.stdin,
    output,
    ...(options.terminal !== undefined ? { terminal: options.terminal } : {}),
  });

  const buffered: string[] = [];
  const interruptHandlers = new Set<() => void>();
  let waiter: ((line: string | null) => void) | undefined;
  let closed = false;

  rl.on('line', (line) => {
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve(line);
      return;
    }
    // Piped input arrives ahead of the prompt; keep it. On a TTY, text typed
    // while a run is streaming is dropped instead of leaking into the next turn.
    if (!rl.terminal) buffered.push(line);
  });
  rl.on('close', () => {
    closed = true;
    const resolve = waiter;
    waiter = undefined;
    resolve?.(null);
  });
  // Raw-mode TTYs deliver Ctrl-C here instead of as a process signal.
  rl.on('SIGINT', () => {
    if (interruptHandlers.size > 0) {
      for (const handler of [...interruptHandlers]) handler();
      return;
    }
    rl.close();
  });

  function readLine(prompt: string): Promise<string | null> {
    const queued = buffered.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (closed) return Promise.resolve(null);
    const lines = prompt.split('\n');
    const last = lines.pop() ?? '';
    if (lines.length > 0) output.write(`${lines.join('\n')}\n`);
    rl.setPrompt(last);
    rl.prompt();
    return new Promise((resolve) => {
      waiter = resolve;
    });
  }

  return {
    readLine,
    createSessionIo(base) {
      return {
        ...base,
        prompt: async (question) => ((await readLine(question)) ?? '').trim(),
        onInterrupt: (handler) => {
          const unsubscribe = base.onInterrupt?.(handler);
          interruptHandlers.add(handler);
          return () => {
            interruptHandlers.delete(handler);
            unsubscribe?.();
          };
        },
      };
    },
    close() {
      if (!closed) rl.close();
    },
  };
}
