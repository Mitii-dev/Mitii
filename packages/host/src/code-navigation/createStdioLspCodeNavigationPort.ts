import { extname, resolve } from "node:path";

import type {
  CodeNavigationCapability,
  CodeNavigationDocumentQuery,
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
} from "@mitii/v8";
import { CODE_NAVIGATION_OPERATIONS, CODE_NAVIGATION_POLICY } from "@mitii/v8";

import { StdioLspClient } from "./stdio-lsp/StdioLspClient.js";
import {
  mapDocumentSymbols,
  mapHover,
  mapLspLocations,
  mapLspSymbolInformations,
  readDocumentText,
  toTextDocumentIdentifier,
  toTextDocumentPosition,
} from "./stdio-lsp/mapLspResults.js";

const MAX_LOCATIONS = CODE_NAVIGATION_POLICY.maximumLocations;

export interface StdioLspServerConfig {
  /** Stable id used in logs and tool capability reason. */
  id: string;
  command: string;
  args?: readonly string[];
  /** File extensions this server handles, e.g. [".py", ".pyi"]. */
  extensions: readonly string[];
  languageId?: string;
  initialization?: Record<string, unknown>;
  env?: Record<string, string>;
  requestTimeoutMs?: number;
}

export interface CreateStdioLspCodeNavigationPortOptions {
  workspaceRoot: string;
  servers: readonly StdioLspServerConfig[];
  abortSignal?: AbortSignal;
}

/**
 * Host-owned multi-language LSP port (OpenClaw/Opencode injection pattern).
 * Spawns configured stdio language servers, routes by extension, falls through
 * empty results so FallbackCodeNavigationAdapter can use the repo graph.
 * V8 never imports this — hosts compose it into createHostCodeNavigationPort.
 */
export function createStdioLspCodeNavigationPort(
  options: CreateStdioLspCodeNavigationPortOptions,
): StdioLspCodeNavigationPort {
  const clients = new Map<string, StdioLspClient>();
  const extensionToServerId = new Map<string, string>();
  const broken = new Set<string>();
  const spawning = new Map<string, Promise<StdioLspClient | undefined>>();

  for (const server of options.servers) {
    for (const extension of server.extensions) {
      const normalized = normalizeExtension(extension);
      if (!extensionToServerId.has(normalized)) {
        extensionToServerId.set(normalized, server.id);
      }
    }
  }

  const configs = new Map(options.servers.map((server) => [server.id, server]));

  const ensureClient = async (
    serverId: string,
  ): Promise<StdioLspClient | undefined> => {
    if (broken.has(serverId)) return undefined;
    const existing = clients.get(serverId);
    if (existing) return existing;
    const inflight = spawning.get(serverId);
    if (inflight) return inflight;

    const config = configs.get(serverId);
    if (!config) return undefined;

    const task = (async () => {
      try {
        const client = await StdioLspClient.start(
          {
            id: config.id,
            command: config.command,
            args: config.args,
            cwd: options.workspaceRoot,
            env: config.env,
            initialization: config.initialization,
            requestTimeoutMs: config.requestTimeoutMs,
          },
          { abortSignal: options.abortSignal },
        );
        clients.set(serverId, client);
        return client;
      } catch {
        broken.add(serverId);
        return undefined;
      } finally {
        if (spawning.get(serverId) === task) {
          spawning.delete(serverId);
        }
      }
    })();
    spawning.set(serverId, task);
    return task;
  };

  return new StdioLspCodeNavigationPort({
    workspaceRoot: options.workspaceRoot,
    extensionToServerId,
    configs,
    ensureClient,
    clients,
  });
}

export class StdioLspCodeNavigationPort implements CodeNavigationPort {
  public readonly id = "stdio-lsp-code-navigation";
  public readonly provider = "language_server" as const;

  constructor(
    private readonly state: {
      workspaceRoot: string;
      extensionToServerId: Map<string, string>;
      configs: Map<string, StdioLspServerConfig>;
      ensureClient: (serverId: string) => Promise<StdioLspClient | undefined>;
      clients: Map<string, StdioLspClient>;
    },
  ) {}

  public capability(): CodeNavigationCapability {
    const attached = this.state.clients.size > 0;
    return {
      status: attached ? "available" : "degraded",
      provider: "language_server",
      reason: attached
        ? `stdio_lsp:${[...this.state.clients.keys()].join(",")}`
        : "stdio_lsp_not_started",
      operations: CODE_NAVIGATION_OPERATIONS,
    };
  }

  public async prepare(relativePath: string): Promise<void> {
    const client = await this.clientForPath(relativePath);
    if (!client) return;
    await this.openDocument(client, relativePath);
  }

  public async definition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.positionRequest(input, "textDocument/definition");
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.positionRequest(input, "textDocument/typeDefinition");
  }

  public async references(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const client = await this.clientForPath(input.relativePath);
    if (!client) return [];
    await this.openDocument(client, input.relativePath);
    const absolute = resolve(this.state.workspaceRoot, input.relativePath);
    const result = await client.request(
      "textDocument/references",
      {
        ...toTextDocumentPosition(
          absolute,
          input.line,
          input.column ?? 1,
        ),
        context: {
          includeDeclaration: input.includeDeclaration !== false,
        },
      },
    );
    return mapLspLocations(result, this.state.workspaceRoot, MAX_LOCATIONS);
  }

  public async hover(
    input: CodeNavigationQuery,
  ): Promise<CodeNavigationHover | undefined> {
    const client = await this.clientForPath(input.relativePath);
    if (!client) return undefined;
    await this.openDocument(client, input.relativePath);
    const absolute = resolve(this.state.workspaceRoot, input.relativePath);
    const result = await client.request(
      "textDocument/hover",
      toTextDocumentPosition(absolute, input.line, input.column ?? 1),
    );
    return mapHover(result);
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const client = await this.clientForPath(input.relativePath);
    if (!client) return [];
    await this.openDocument(client, input.relativePath);
    const absolute = resolve(this.state.workspaceRoot, input.relativePath);
    const result = await client.request(
      "textDocument/documentSymbol",
      toTextDocumentIdentifier(absolute),
    );
    return mapDocumentSymbols(
      result,
      input.relativePath,
      this.state.workspaceRoot,
      MAX_LOCATIONS,
    );
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    // Prefer any live client; workspace/symbol is workspace-scoped.
    const client =
      [...this.state.clients.values()][0] ??
      (await this.startAnyClient());
    if (!client) return [];
    const result = await client.request("workspace/symbol", {
      query: input.query,
    });
    return mapLspSymbolInformations(
      result,
      this.state.workspaceRoot,
      MAX_LOCATIONS,
    );
  }

  public async implementation(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.positionRequest(input, "textDocument/implementation");
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const client = await this.clientForPath(input.relativePath);
    if (!client) return [];
    await this.openDocument(client, input.relativePath);
    const absolute = resolve(this.state.workspaceRoot, input.relativePath);
    const prepared = await client.request<unknown>(
      "textDocument/prepareCallHierarchy",
      toTextDocumentPosition(absolute, input.line, input.column ?? 1),
    );
    const items = Array.isArray(prepared) ? prepared : prepared ? [prepared] : [];
    const root = items[0];
    if (!root || typeof root !== "object") return [];
    const method =
      (input.direction ?? "outgoing") === "incoming"
        ? "callHierarchy/incomingCalls"
        : "callHierarchy/outgoingCalls";
    const calls = await client.request<unknown>(method, { item: root });
    if (!Array.isArray(calls)) return [];
    const locations: CodeNavigationLocation[] = [];
    for (const call of calls) {
      if (!call || typeof call !== "object") continue;
      const record = call as Record<string, unknown>;
      const item =
        (input.direction ?? "outgoing") === "incoming"
          ? record.from
          : record.to;
      if (!item || typeof item !== "object") continue;
      const mapped = mapLspLocations(
        [
          {
            uri: (item as { uri?: string }).uri,
            range:
              (item as { selectionRange?: unknown }).selectionRange ??
              (item as { range?: unknown }).range,
          },
        ],
        this.state.workspaceRoot,
        1,
      );
      const location = mapped[0];
      if (!location) continue;
      locations.push({
        ...location,
        ...((item as { name?: string }).name
          ? { symbolName: (item as { name: string }).name }
          : {}),
        ...((item as { kind?: number }).kind !== undefined
          ? { symbolKind: String((item as { kind: number }).kind) }
          : {}),
      });
      if (locations.length >= MAX_LOCATIONS) break;
    }
    return locations;
  }

  public async dispose(): Promise<void> {
    await Promise.all(
      [...this.state.clients.values()].map((client) => client.dispose()),
    );
    this.state.clients.clear();
  }

  private async positionRequest(
    input: CodeNavigationQuery,
    method: string,
  ): Promise<readonly CodeNavigationLocation[]> {
    const client = await this.clientForPath(input.relativePath);
    if (!client) return [];
    await this.openDocument(client, input.relativePath);
    const absolute = resolve(this.state.workspaceRoot, input.relativePath);
    const result = await client.request(
      method,
      toTextDocumentPosition(absolute, input.line, input.column ?? 1),
    );
    return mapLspLocations(result, this.state.workspaceRoot, MAX_LOCATIONS);
  }

  private async clientForPath(
    relativePath: string,
  ): Promise<StdioLspClient | undefined> {
    const extension = normalizeExtension(extname(relativePath));
    const serverId = this.state.extensionToServerId.get(extension);
    if (!serverId) return undefined;
    return this.state.ensureClient(serverId);
  }

  private async startAnyClient(): Promise<StdioLspClient | undefined> {
    for (const serverId of this.state.configs.keys()) {
      const client = await this.state.ensureClient(serverId);
      if (client) return client;
    }
    return undefined;
  }

  private async openDocument(
    client: StdioLspClient,
    relativePath: string,
  ): Promise<void> {
    const absolute = resolve(this.state.workspaceRoot, relativePath);
    const text = readDocumentText(absolute);
    if (text === undefined) return;
    const extension = normalizeExtension(extname(relativePath));
    const serverId = this.state.extensionToServerId.get(extension);
    const config = serverId ? this.state.configs.get(serverId) : undefined;
    await client.didOpen({
      absolutePath: absolute,
      languageId: config?.languageId ?? languageIdForExtension(extension),
      text,
    });
  }
}

function normalizeExtension(extension: string): string {
  const value = extension.trim().toLowerCase();
  if (!value) return "";
  return value.startsWith(".") ? value : `.${value}`;
}

function languageIdForExtension(extension: string): string {
  switch (extension) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
    case ".pyi":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    default:
      return extension.replace(/^\./, "") || "plaintext";
  }
}
