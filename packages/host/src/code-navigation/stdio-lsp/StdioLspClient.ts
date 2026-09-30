import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  appendLspChunk,
  createLspInputBuffer,
  encodeLspMessage,
  type LspInputBuffer,
} from "./framing.js";
import { PendingRequestRegistry } from "./PendingRequestRegistry.js";

export type StdioLspServerCapabilities = {
  hoverProvider?: boolean | object;
  definitionProvider?: boolean | object;
  typeDefinitionProvider?: boolean | object;
  referencesProvider?: boolean | object;
  documentSymbolProvider?: boolean | object;
  workspaceSymbolProvider?: boolean | object;
  implementationProvider?: boolean | object;
  callHierarchyProvider?: boolean | object;
  [key: string]: unknown;
};

export type StdioLspServerLaunch = {
  id: string;
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: Record<string, string>;
  initialization?: Record<string, unknown>;
  requestTimeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_GRACE_MS = 500;

export class StdioLspClient {
  public readonly id: string;
  public capabilities: StdioLspServerCapabilities = {};
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new PendingRequestRegistry();
  private readonly opened = new Map<string, number>();
  private input: LspInputBuffer = createLspInputBuffer();
  private requestId = 0;
  private disposed = false;
  private failure?: Error;
  private readonly requestTimeoutMs: number;
  private readonly initialization: Record<string, unknown>;

  private constructor(
    launch: StdioLspServerLaunch,
    child: ChildProcessWithoutNullStreams,
  ) {
    this.id = launch.id;
    this.child = child;
    this.requestTimeoutMs = launch.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.initialization = launch.initialization ?? {};
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", () => {
      // Keep draining stderr so the child cannot block on a full pipe.
    });
    child.on("error", (error) => this.fail(error));
    child.on("exit", (code, signal) => {
      this.fail(
        new Error(
          `LSP server "${this.id}" exited (${signal ?? code ?? "unknown"})`,
        ),
      );
    });
  }

  public static async start(
    launch: StdioLspServerLaunch,
    options: { abortSignal?: AbortSignal } = {},
  ): Promise<StdioLspClient> {
    throwIfAborted(options.abortSignal);
    const child = spawn(launch.command, [...(launch.args ?? [])], {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (!child.stdin || !child.stdout) {
      child.kill("SIGKILL");
      throw new Error(`LSP server "${launch.id}" failed to open stdio pipes.`);
    }
    const client = new StdioLspClient(
      launch,
      child as ChildProcessWithoutNullStreams,
    );
    try {
      throwIfAborted(options.abortSignal);
      const capabilities = await client.request<StdioLspServerCapabilities>(
        "initialize",
        {
          processId: process.pid,
          rootUri: pathToFileURL(launch.cwd).href,
          rootPath: launch.cwd,
          capabilities: {
            textDocument: {
              hover: { contentFormat: ["plaintext", "markdown"] },
              definition: { linkSupport: true },
              typeDefinition: { linkSupport: true },
              references: {},
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
              implementation: { linkSupport: true },
              callHierarchy: {},
            },
            workspace: {
              symbol: {},
            },
          },
          initializationOptions: client.initialization,
          workspaceFolders: [
            {
              uri: pathToFileURL(launch.cwd).href,
              name: launch.id,
            },
          ],
        },
        options.abortSignal,
      );
      client.capabilities = capabilities ?? {};
      await client.notify("initialized", {});
      return client;
    } catch (error) {
      await client.dispose();
      throw error;
    }
  }

  public async didOpen(params: {
    absolutePath: string;
    languageId: string;
    text: string;
  }): Promise<void> {
    const uri = pathToFileURL(params.absolutePath).href;
    const version = (this.opened.get(uri) ?? 0) + 1;
    this.opened.set(uri, version);
    await this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: params.languageId,
        version,
        text: params.text,
      },
    });
  }

  public async request<T = unknown>(
    method: string,
    params?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.disposed && method !== "shutdown") {
      throw new Error(`LSP session "${this.id}" disposed`);
    }
    if (this.failure) throw this.failure;
    throwIfAborted(signal);

    const id = ++this.requestId;
    const onAbort = () => {
      const pending = this.pending.take(id);
      if (!pending) return;
      try {
        this.write({
          jsonrpc: "2.0",
          method: "$/cancelRequest",
          params: { id },
        });
      } catch {
        // Best-effort; local promise must still settle.
      }
      pending.reject(abortError(signal));
    };

    const promise = this.pending.add<T>(id, this.requestTimeoutMs, () =>
      new Error(`LSP request ${method} timed out`),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      this.write({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      this.pending.take(id)?.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    try {
      return await promise;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  public async notify(method: string, params?: unknown): Promise<void> {
    if (this.disposed) return;
    if (this.failure) throw this.failure;
    this.write({ jsonrpc: "2.0", method, params });
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.rejectAll(new Error(`LSP session "${this.id}" disposed`));
    try {
      await Promise.race([
        this.request("shutdown", undefined).catch(() => undefined),
        settleAfter(SHUTDOWN_GRACE_MS),
      ]);
      await this.notify("exit", undefined).catch(() => undefined);
    } catch {
      // Force-close below.
    }
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
      await settleAfter(SHUTDOWN_GRACE_MS);
      if (!this.child.killed) {
        this.child.kill("SIGKILL");
      }
    }
  }

  private write(message: unknown): void {
    if (!this.child.stdin.writable) {
      throw new Error(`LSP server "${this.id}" stdin is closed`);
    }
    this.child.stdin.write(encodeLspMessage(message));
  }

  private onData(chunk: Buffer): void {
    const parsed = appendLspChunk(this.input, chunk);
    for (const message of parsed.messages) {
      this.dispatch(message);
    }
    if (!parsed.ok) {
      this.fail(parsed.error);
    }
  }

  private dispatch(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    if (!("id" in record)) {
      // Notification from server — ignore.
      return;
    }
    // Server → client request (has method + id).
    if ("method" in record) {
      try {
        this.write({ jsonrpc: "2.0", id: record.id, result: null });
      } catch {
        // ignore
      }
      return;
    }
    const id = typeof record.id === "number" ? record.id : Number(record.id);
    if (!Number.isFinite(id)) return;
    const pending = this.pending.take(id);
    if (!pending) return;
    if ("error" in record) {
      pending.reject(new Error(JSON.stringify(record.error)));
    } else {
      pending.resolve(record.result);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.pending.rejectAll(this.failure);
  }
}

function settleAfter(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("LSP request aborted");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}
