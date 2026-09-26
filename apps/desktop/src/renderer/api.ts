/**
 * Renderer → engine HTTP client (no Node; uses bridge for base URL).
 */

import {
  MITII_DESKTOP_BRIDGE_KEY,
  type MitiiDesktopBridge,
} from '../shared/bridge.js';
import {
  extractAssistantAnswer,
  extractAssistantDelta,
  extractRunError,
  extractRunStatus,
} from '../shared/extract-run-text.js';
import type {
  DesktopAgentMode,
  DesktopHealthResponse,
  DesktopPromptStreamLine,
} from '../shared/protocol.js';

export function getDesktopBridge(): MitiiDesktopBridge | undefined {
  return window[MITII_DESKTOP_BRIDGE_KEY];
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchHealth(
  baseUrl: string,
): Promise<DesktopHealthResponse> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) throw new Error(`health_${res.status}`);
  return (await res.json()) as DesktopHealthResponse;
}

export async function* streamNdjson(
  url: string,
  init: RequestInit,
): AsyncGenerator<DesktopPromptStreamLine> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`stream_${res.status}:${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          yield JSON.parse(line) as DesktopPromptStreamLine;
        }
        newline = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) {
      yield JSON.parse(tail) as DesktopPromptStreamLine;
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export async function* streamPrompt(options: {
  baseUrl: string;
  prompt: string;
  mode: DesktopAgentMode;
  token?: string;
  model?: string;
  sessionId?: string;
  approvalPreset?: string;
  thoroughness?: string;
  pinnedPaths?: string[];
  requiredSkillIds?: string[];
  requiredMcpServerIds?: string[];
  /** Prior turns for Agent Engine (VS Code conversationCarry parity). */
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  approvedPlan?: unknown;
  approvedPlanStrategy?: unknown;
  taskList?: unknown;
  signal?: AbortSignal;
}): AsyncGenerator<DesktopPromptStreamLine> {
  yield* streamNdjson(`${options.baseUrl}/v1/prompt`, {
    method: 'POST',
    headers: authHeaders(options.token),
    signal: options.signal,
    body: JSON.stringify({
      prompt: options.prompt,
      mode: options.mode,
      ...(options.model?.trim() ? { model: options.model.trim() } : {}),
      ...(options.sessionId?.trim()
        ? { sessionId: options.sessionId.trim() }
        : {}),
      ...(options.approvalPreset
        ? { approvalPreset: options.approvalPreset }
        : {}),
      ...(options.thoroughness ? { thoroughness: options.thoroughness } : {}),
      ...(options.pinnedPaths?.length
        ? { pinnedPaths: options.pinnedPaths }
        : {}),
      ...(options.requiredSkillIds?.length
        ? { requiredSkillIds: options.requiredSkillIds }
        : {}),
      ...(options.requiredMcpServerIds?.length
        ? { requiredMcpServerIds: options.requiredMcpServerIds }
        : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(options.approvedPlan ? { approvedPlan: options.approvedPlan } : {}),
      ...(options.approvedPlanStrategy
        ? { approvedPlanStrategy: options.approvedPlanStrategy }
        : {}),
      ...(options.taskList ? { taskList: options.taskList } : {}),
    }),
  });
}

export async function* streamResume(options: {
  baseUrl: string;
  token?: string;
  mode?: DesktopAgentMode;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): AsyncGenerator<DesktopPromptStreamLine> {
  yield* streamNdjson(`${options.baseUrl}/v1/resume`, {
    method: 'POST',
    headers: authHeaders(options.token),
    signal: options.signal,
    body: JSON.stringify({
      ...options.body,
      ...(options.mode ? { mode: options.mode } : {}),
    }),
  });
}

export async function fetchSkills(options: {
  baseUrl: string;
  token?: string;
}): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    source?: 'workspace' | 'bundled';
  }>
> {
  const res = await fetch(`${options.baseUrl}/v1/skills`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`skills_${res.status}`);
  const json = (await res.json()) as {
    skills: Array<{
      id: string;
      title: string;
      description: string;
      source?: 'workspace' | 'bundled';
    }>;
  };
  return json.skills ?? [];
}

export async function fetchWorkspaceSkills(options: {
  baseUrl: string;
  token?: string;
}): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    source: 'workspace';
  }>
> {
  const res = await fetch(`${options.baseUrl}/v1/skills/workspace`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`skills_ws_${res.status}`);
  const json = (await res.json()) as {
    skills: Array<{
      id: string;
      title: string;
      description: string;
      source: 'workspace';
    }>;
  };
  return json.skills ?? [];
}

export async function fetchWorkspaceSkill(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<{
  id: string;
  title: string;
  description: string;
  body: string;
  frontmatterYaml?: string | null;
  markdown?: string;
  path?: string;
}> {
  const res = await fetch(
    `${options.baseUrl}/v1/skills/workspace?id=${encodeURIComponent(options.id)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`skill_${res.status}`);
  const json = (await res.json()) as {
    skill: {
      id: string;
      title: string;
      description: string;
      body: string;
      frontmatterYaml?: string | null;
      markdown?: string;
      path?: string;
    };
  };
  return json.skill;
}

export async function saveWorkspaceSkill(options: {
  baseUrl: string;
  token?: string;
  id?: string;
  title?: string;
  description?: string;
  body?: string;
  markdown?: string;
  formatFrontmatter?: boolean;
  useAi?: boolean;
}): Promise<{
  ok: boolean;
  id: string;
  path: string;
  skill?: {
    id: string;
    title: string;
    description: string;
    body: string;
    markdown?: string;
  };
  usedAi?: boolean;
  recipeId?: string;
  profileName?: string;
}> {
  const res = await fetch(`${options.baseUrl}/v1/skills/workspace`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'save',
      id: options.id,
      title: options.title,
      description: options.description,
      body: options.body,
      markdown: options.markdown,
      formatFrontmatter: options.formatFrontmatter !== false,
      useAi: options.useAi !== false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`skill_save_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof saveWorkspaceSkill>>;
}

export async function formatWorkspaceSkill(options: {
  baseUrl: string;
  token?: string;
  id?: string;
  title?: string;
  description?: string;
  body?: string;
  markdown?: string;
  useAi?: boolean;
}): Promise<{
  ok: boolean;
  id: string;
  title: string;
  description: string;
  body: string;
  markdown: string;
  usedAi: boolean;
  recipeId: string;
  profileName: string;
}> {
  const res = await fetch(`${options.baseUrl}/v1/skills/format`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      id: options.id,
      title: options.title,
      description: options.description,
      body: options.body,
      markdown: options.markdown,
      useAi: options.useAi !== false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`skill_format_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof formatWorkspaceSkill>>;
}

export async function deleteWorkspaceSkillApi(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${options.baseUrl}/v1/skills/workspace`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ action: 'delete', id: options.id }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`skill_delete_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof deleteWorkspaceSkillApi>
  >;
}

export async function fetchMcpServers(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  enabled: boolean;
  servers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    transport?: string;
    builtin?: boolean;
  }>;
  catalog: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    category?: string;
    secrets?: Array<{
      key: string;
      label: string;
      secret?: boolean;
      required?: boolean;
      placeholder?: string;
      hint?: string;
    }>;
    installed: boolean;
  }>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`mcp_${res.status}`);
  const data = (await res.json()) as Partial<
    Awaited<ReturnType<typeof fetchMcpServers>>
  >;
  return {
    enabled: Boolean(data.enabled),
    servers: Array.isArray(data.servers) ? data.servers : [],
    catalog: Array.isArray(data.catalog) ? data.catalog : [],
  };
}

export async function setMcpEnabled(options: {
  baseUrl: string;
  token?: string;
  enabled?: boolean;
  serverId?: string;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      enabled: options.enabled,
      serverId: options.serverId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_set_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof setMcpEnabled>>;
}

export async function installBuiltinMcp(options: {
  baseUrl: string;
  token?: string;
  builtinId: string;
  secrets?: Record<string, string>;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    category?: string;
    secrets?: Array<{
      key: string;
      label: string;
      secret?: boolean;
      required?: boolean;
      placeholder?: string;
      hint?: string;
    }>;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'install',
      builtinId: options.builtinId,
      ...(options.secrets ? { secrets: options.secrets } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_install_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof installBuiltinMcp>>;
}

export async function addCustomMcp(options: {
  baseUrl: string;
  token?: string;
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'add',
      id: options.id,
      name: options.name,
      transport: options.transport,
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      url: options.url,
      headers: options.headers,
      enabled: options.enabled,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_add_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof addCustomMcp>>;
}

export async function deleteMcpServer(options: {
  baseUrl: string;
  token?: string;
  serverId: string;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'delete',
      serverId: options.serverId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_delete_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof deleteMcpServer>>;
}

export async function fetchRecipes(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  recipes: Array<{
    id: string;
    title: string;
    description: string;
    source: 'builtin' | 'workspace';
    mode: 'ask' | 'plan' | 'agent';
  }>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/recipes`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`recipes_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchRecipes>>;
}

export async function saveRecipe(options: {
  baseUrl: string;
  token?: string;
  recipe: Record<string, unknown>;
}): Promise<{ ok: boolean; id: string; path: string }> {
  const res = await fetch(`${options.baseUrl}/v1/recipes`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ recipe: options.recipe }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`recipe_save_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof saveRecipe>>;
}

export async function runRecipe(options: {
  baseUrl: string;
  token?: string;
  id: string;
  params?: Record<string, string>;
  note?: string;
}): Promise<{
  ok: boolean;
  compiled: {
    recipeId: string;
    title: string;
    prompt: string;
    mode: 'ask' | 'plan' | 'agent';
    requiredSkillIds: string[];
    label: string;
  };
}> {
  const res = await fetch(`${options.baseUrl}/v1/recipes/run`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      id: options.id,
      params: options.params,
      note: options.note,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`recipe_run_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof runRecipe>>;
}

/** Prefer streamed deltas; fall back to result.answer (previews are truncated). */
export function extractAssistantText(line: DesktopPromptStreamLine): string {
  if (line.op === 'event') return extractAssistantDelta(line.event);
  if (line.op === 'result') return extractAssistantAnswer(line.result);
  return '';
}

export function finalizeAssistantText(
  streamed: string,
  line: DesktopPromptStreamLine,
): string {
  if (line.op !== 'result') return streamed;
  const answer = extractAssistantAnswer(line.result);
  if (answer) return answer;
  const status = extractRunStatus(line.result);
  const err = extractRunError(line.result);
  if (err) return streamed || `Run failed: ${err}`;
  if (status && status !== 'completed' && !streamed) {
    return `Run ended with status=${status}`;
  }
  return streamed;
}

export async function testConnection(options: {
  baseUrl: string;
  token?: string;
  type: string;
  providerBaseUrl?: string;
  model: string;
  apiKey?: string;
}): Promise<{ ok: boolean; message: string; models?: string[] }> {
  const res = await fetch(`${options.baseUrl}/v1/provider/test`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      type: options.type,
      baseUrl: options.providerBaseUrl,
      model: options.model,
      apiKey: options.apiKey,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`test_${res.status}:${text}`);
  }
  return (await res.json()) as {
    ok: boolean;
    message: string;
    models?: string[];
  };
}

export async function fetchProviderModels(options: {
  baseUrl: string;
  token?: string;
  type: string;
  providerBaseUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  const res = await fetch(`${options.baseUrl}/v1/provider/models`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      type: options.type,
      baseUrl: options.providerBaseUrl,
      apiKey: options.apiKey,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`models_${res.status}:${text}`);
  }
  const data = (await res.json()) as { models?: string[] };
  return Array.isArray(data.models)
    ? data.models.filter((id) => typeof id === 'string' && id.trim())
    : [];
}

export type OllamaPullStreamLine =
  | { op: 'start'; model: string }
  | {
      op: 'progress';
      status: string;
      percent?: number;
      total?: number;
      completed?: number;
    }
  | { op: 'done'; ok: true; model: string }
  | { op: 'done'; ok: false; error: string };

/**
 * Pull an Ollama model through the desktop engine (NDJSON progress).
 * Used for optional embedding upgrades such as nomic-embed-text.
 */
export async function* streamOllamaPull(options: {
  baseUrl: string;
  token?: string;
  model: string;
  providerBaseUrl?: string;
}): AsyncGenerator<OllamaPullStreamLine> {
  const res = await fetch(`${options.baseUrl}/v1/ollama/pull`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      model: options.model,
      baseUrl: options.providerBaseUrl,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`ollama_pull_${res.status}:${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        yield JSON.parse(line) as OllamaPullStreamLine;
      }
      newline = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail) {
    yield JSON.parse(tail) as OllamaPullStreamLine;
  }
}

export async function pullOllamaEmbeddingModel(options: {
  baseUrl: string;
  token?: string;
  model: string;
  providerBaseUrl?: string;
  onProgress?: (progress: {
    status: string;
    percent?: number;
  }) => void;
}): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  let lastError = 'Ollama pull failed.';
  for await (const line of streamOllamaPull(options)) {
    if (line.op === 'progress') {
      options.onProgress?.({
        status: line.status,
        ...(line.percent !== undefined ? { percent: line.percent } : {}),
      });
    } else if (line.op === 'done') {
      if (line.ok) {
        return { ok: true, model: line.model };
      }
      return { ok: false, error: line.error };
    }
  }
  return { ok: false, error: lastError };
}

export interface MemoryItemView {
  id: string;
  text: string;
  createdAt: string;
}

export interface CheckpointItemView {
  id: string;
  label: string;
  createdAt: string;
  changedPaths?: string[];
}

export async function fetchMemories(options: {
  baseUrl: string;
  token?: string;
}): Promise<MemoryItemView[]> {
  const res = await fetch(`${options.baseUrl}/v1/memory`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_${res.status}:${text}`);
  }
  const data = (await res.json()) as { memories?: MemoryItemView[] };
  return Array.isArray(data.memories) ? data.memories : [];
}

export async function addMemory(options: {
  baseUrl: string;
  token?: string;
  text: string;
}): Promise<MemoryItemView[]> {
  const res = await fetch(`${options.baseUrl}/v1/memory`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ text: options.text }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_add_${res.status}:${text}`);
  }
  const data = (await res.json()) as { memories?: MemoryItemView[] };
  return Array.isArray(data.memories) ? data.memories : [];
}

export async function deleteMemory(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<MemoryItemView[]> {
  const res = await fetch(
    `${options.baseUrl}/v1/memory/${encodeURIComponent(options.id)}`,
    {
      method: 'DELETE',
      headers: authHeaders(options.token),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_delete_${res.status}:${text}`);
  }
  const data = (await res.json()) as { memories?: MemoryItemView[] };
  return Array.isArray(data.memories) ? data.memories : [];
}

export async function clearMemories(options: {
  baseUrl: string;
  token?: string;
}): Promise<void> {
  const res = await fetch(`${options.baseUrl}/v1/memory/clear`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_clear_${res.status}:${text}`);
  }
}

export async function fetchCheckpoints(options: {
  baseUrl: string;
  token?: string;
}): Promise<CheckpointItemView[]> {
  const res = await fetch(`${options.baseUrl}/v1/checkpoints`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoints_${res.status}:${text}`);
  }
  const data = (await res.json()) as { checkpoints?: CheckpointItemView[] };
  return Array.isArray(data.checkpoints) ? data.checkpoints : [];
}

export async function deleteCheckpoint(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<CheckpointItemView[]> {
  const res = await fetch(
    `${options.baseUrl}/v1/checkpoints/${encodeURIComponent(options.id)}`,
    {
      method: 'DELETE',
      headers: authHeaders(options.token),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoint_delete_${res.status}:${text}`);
  }
  const data = (await res.json()) as { checkpoints?: CheckpointItemView[] };
  return Array.isArray(data.checkpoints) ? data.checkpoints : [];
}

export async function clearCheckpoints(options: {
  baseUrl: string;
  token?: string;
}): Promise<void> {
  const res = await fetch(`${options.baseUrl}/v1/checkpoints/clear`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoints_clear_${res.status}:${text}`);
  }
}

export async function restoreCheckpoint(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/checkpoints/${encodeURIComponent(options.id)}/restore`,
    {
      method: 'POST',
      headers: authHeaders(options.token),
      body: '{}',
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoint_restore_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; message: string };
}

export async function fetchProfiles(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  activeProfileId: string;
  profiles: Array<{
    id: string;
    name: string;
    provider: {
      type: string;
      preset?: string;
      baseUrl: string;
      model: string;
      contextWindow: number;
      maximumOutputTokens: number;
    };
    hasSecret: boolean;
  }>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/profiles`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`profiles_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchProfiles>>;
}

export async function postProfiles(options: {
  baseUrl: string;
  token?: string;
  body: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch(`${options.baseUrl}/v1/profiles`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify(options.body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`profiles_${res.status}:${text}`);
  }
  return res.json();
}

export async function fetchHistory(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  threads: Array<{
    id: string;
    title: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      text: string;
      mode?: string;
    }>;
  }>;
  activeThreadId?: string;
}> {
  const res = await fetch(`${options.baseUrl}/v1/history`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`history_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchHistory>>;
}

export async function postHistory(options: {
  baseUrl: string;
  token?: string;
  body: Record<string, unknown>;
}): Promise<Awaited<ReturnType<typeof fetchHistory>>> {
  const res = await fetch(`${options.baseUrl}/v1/history`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify(options.body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`history_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof fetchHistory>>;
}

export async function deleteHistoryThread(options: {
  baseUrl: string;
  token?: string;
  threadId: string;
}): Promise<Awaited<ReturnType<typeof fetchHistory>>> {
  return postHistory({
    baseUrl: options.baseUrl,
    token: options.token,
    body: { action: 'delete', threadId: options.threadId },
  });
}

export async function fetchIndexStatus(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  indexed: boolean;
  fileCount: number;
  truncated: boolean;
  lastIndexedAt?: string;
  message: string;
  running?: boolean;
  lockStartedAt?: number;
  progressPercent?: number;
  progressStage?: string;
  progressMessage?: string;
  embeddingError?: string;
  lexicalReady?: boolean;
  embeddingPhase?: string;
}> {
  const res = await fetch(`${options.baseUrl}/v1/index/status`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`index_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchIndexStatus>>;
}

export type IndexReindexProgressEvent = {
  type: 'progress';
  stage: string;
  message: string;
  percent?: number;
  fileCount?: number;
  lexicalReady?: boolean;
  embeddingPhase?: string;
};

export type IndexReindexResultEvent = {
  type: 'result';
  status: string;
  fileCount: number;
  message: string;
  truncated?: boolean;
  statusSnapshot?: Awaited<ReturnType<typeof fetchIndexStatus>>;
};

export async function reindexWorkspace(options: {
  baseUrl: string;
  token?: string;
  maximumFiles?: number;
  concurrency?: number;
  /** Full rebuild — only when user clicks Rebuild. Default false. */
  force?: boolean;
  filePaths?: readonly string[];
  semanticIndex?: Record<string, unknown>;
  onProgress?: (event: IndexReindexProgressEvent) => void;
}): Promise<{
  status: string;
  fileCount: number;
  message: string;
  statusSnapshot?: Awaited<ReturnType<typeof fetchIndexStatus>>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/index/reindex`, {
    method: 'POST',
    headers: {
      ...authHeaders(options.token),
      Accept: 'application/x-ndjson',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      maximumFiles: options.maximumFiles,
      concurrency: options.concurrency,
      semanticIndex: options.semanticIndex,
      force: options.force === true,
      ...(options.filePaths?.length ? { filePaths: options.filePaths } : {}),
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`reindex_${res.status}:${text}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('ndjson') || !res.body) {
    return (await res.json()) as Awaited<ReturnType<typeof reindexWorkspace>>;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: IndexReindexResultEvent | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: { type?: string } & Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as { type?: string } & Record<
          string,
          unknown
        >;
      } catch {
        continue;
      }
      if (parsed.type === 'progress') {
        options.onProgress?.(parsed as IndexReindexProgressEvent);
      } else if (parsed.type === 'result') {
        result = parsed as IndexReindexResultEvent;
      } else if (parsed.type === 'error') {
        throw new Error(
          typeof parsed.message === 'string'
            ? parsed.message
            : 'reindex_failed',
        );
      }
    }
  }

  if (!result) {
    throw new Error('reindex_incomplete');
  }
  return {
    status: result.status,
    fileCount: result.fileCount,
    message: result.message,
    statusSnapshot: result.statusSnapshot,
  };
}

export async function pauseIndexing(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${options.baseUrl}/v1/index/pause`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`index_pause_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; message?: string };
}

export async function openLatestSessionLog(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ path?: string; content?: string; message?: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/evidence/session-log/latest`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`session_log_latest_${res.status}:${text}`);
  }
  return (await res.json()) as {
    path?: string;
    content?: string;
    message?: string;
  };
}

export async function exportSessionLog(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/evidence/session-log/export`,
    {
      method: 'POST',
      headers: authHeaders(options.token),
      body: '{}',
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`session_log_export_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; path?: string };
}

export async function exportShareableDiagnostic(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/evidence/shareable-diagnostic`,
    {
      method: 'POST',
      headers: authHeaders(options.token),
      body: '{}',
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`shareable_diagnostic_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; path?: string };
}

export async function exportAuditPack(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(`${options.baseUrl}/v1/evidence/audit-pack`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`audit_pack_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; path?: string };
}

export async function fetchWorkspaceTree(options: {
  baseUrl: string;
  token?: string;
  path?: string;
}): Promise<{
  path: string;
  entries: Array<{ name: string; path: string; kind: 'file' | 'dir' }>;
}> {
  const qs = options.path
    ? `?path=${encodeURIComponent(options.path)}`
    : '';
  const res = await fetch(`${options.baseUrl}/v1/workspace/tree${qs}`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`tree_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchWorkspaceTree>>;
}

export type WorkspaceEventsMessage =
  | { type: 'ready'; at: number; workspaceRoot?: string }
  | { type: 'ping'; at: number }
  | {
      type: 'change';
      at: number;
      paths: string[];
      kind?: string;
    };

/** Long-lived NDJSON stream of workspace filesystem changes. */
export async function* streamWorkspaceEvents(options: {
  baseUrl: string;
  token?: string;
  signal?: AbortSignal;
}): AsyncGenerator<WorkspaceEventsMessage> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/events`, {
    headers: authHeaders(options.token),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`workspace_events_${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          yield JSON.parse(line) as WorkspaceEventsMessage;
        } catch {
          /* skip bad line */
        }
      }
      newline = buffer.indexOf('\n');
    }
  }
}

export async function searchWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  query: string;
}): Promise<Array<{ path: string; kind: 'file' | 'folder' }>> {
  const res = await fetch(
    `${options.baseUrl}/v1/workspace/search?q=${encodeURIComponent(options.query)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`search_${res.status}`);
  const json = (await res.json()) as {
    paths?: Array<string | { path?: string; kind?: string }>;
  };
  const raw = Array.isArray(json.paths) ? json.paths : [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') {
        return { path: entry, kind: 'file' as const };
      }
      const path = typeof entry.path === 'string' ? entry.path : '';
      if (!path) return null;
      return {
        path,
        kind: entry.kind === 'folder' ? ('folder' as const) : ('file' as const),
      };
    })
    .filter((entry): entry is { path: string; kind: 'file' | 'folder' } =>
      Boolean(entry),
    );
}

export async function fetchWorkspaceFile(options: {
  baseUrl: string;
  token?: string;
  path: string;
}): Promise<{
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}> {
  const res = await fetch(
    `${options.baseUrl}/v1/workspace/file?path=${encodeURIComponent(options.path)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`file_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchWorkspaceFile>>;
}

export async function saveWorkspaceFile(options: {
  baseUrl: string;
  token?: string;
  path: string;
  content: string;
}): Promise<{ ok: boolean; path: string; size: number }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/file`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ path: options.path, content: options.content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`save_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof saveWorkspaceFile>>;
}

export async function renameWorkspacePath(options: {
  baseUrl: string;
  token?: string;
  path: string;
  newName: string;
}): Promise<{ ok: boolean; path: string; previousPath: string }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/rename`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ path: options.path, newName: options.newName }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rename_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof renameWorkspacePath>>;
}

export async function deleteWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
}): Promise<{ ok: boolean; deleted: string[] }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/delete`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`delete_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof deleteWorkspacePaths>>;
}

export async function createWorkspaceFilePath(options: {
  baseUrl: string;
  token?: string;
  parent: string;
  name: string;
  content?: string;
}): Promise<{ ok: boolean; path: string }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/create-file`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      parent: options.parent,
      name: options.name,
      content: options.content ?? '',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create_file_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof createWorkspaceFilePath>
  >;
}

export async function createWorkspaceFolderPath(options: {
  baseUrl: string;
  token?: string;
  parent: string;
  name: string;
}): Promise<{ ok: boolean; path: string }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/create-folder`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ parent: options.parent, name: options.name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create_folder_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof createWorkspaceFolderPath>
  >;
}

export async function copyWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
  destDir: string;
}): Promise<{ ok: boolean; results: Array<{ from: string; to: string }> }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/copy`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths, destDir: options.destDir }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`copy_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof copyWorkspacePaths>>;
}

export async function moveWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
  destDir: string;
}): Promise<{ ok: boolean; results: Array<{ from: string; to: string }> }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/move`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths, destDir: options.destDir }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`move_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof moveWorkspacePaths>>;
}

export async function fetchAbsoluteWorkspacePath(options: {
  baseUrl: string;
  token?: string;
  path: string;
}): Promise<string> {
  const res = await fetch(
    `${options.baseUrl}/v1/workspace/absolute?path=${encodeURIComponent(options.path)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`abs_${res.status}`);
  const json = (await res.json()) as { absolute?: string };
  if (!json.absolute) throw new Error('abs_missing');
  return json.absolute;
}

export async function fetchGitStatus(options: {
  baseUrl: string;
  token?: string;
}): Promise<import('../shared/git/workingTree.js').GitWorkingTreeSnapshot> {
  const res = await fetch(`${options.baseUrl}/v1/git/status`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`git_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchGitStatus>>;
}

export async function fetchGitDiff(options: {
  baseUrl: string;
  token?: string;
  path: string;
}): Promise<{ path: string; diff: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/git/diff?path=${encodeURIComponent(options.path)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`git_diff_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchGitDiff>>;
}

export async function fetchGitBranches(options: {
  baseUrl: string;
  token?: string;
}): Promise<import('../shared/git/workingTree.js').GitBranchListSnapshot> {
  const res = await fetch(`${options.baseUrl}/v1/git/branches`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`git_branches_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchGitBranches>>;
}

async function postGitMutation(
  options: {
    baseUrl: string;
    token?: string;
    path: string;
    body?: Record<string, unknown>;
  },
): Promise<import('../shared/git/workingTree.js').GitMutationResult> {
  const res = await fetch(`${options.baseUrl}${options.path}`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify(options.body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`git_mutation_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof postGitMutation>
  >;
}

export async function gitStageFiles(options: {
  baseUrl: string;
  token?: string;
  paths?: string[];
}): Promise<import('../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/stage',
    body: { paths: options.paths },
  });
}

export async function gitUnstageFiles(options: {
  baseUrl: string;
  token?: string;
  paths?: string[];
}): Promise<import('../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/unstage',
    body: { paths: options.paths },
  });
}

export async function gitDiscardFiles(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
  includeUntracked?: boolean;
}): Promise<import('../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/discard',
    body: {
      paths: options.paths,
      includeUntracked: options.includeUntracked === true,
    },
  });
}

export async function gitCommitChanges(options: {
  baseUrl: string;
  token?: string;
  message: string;
  all?: boolean;
}): Promise<import('../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/commit',
    body: { message: options.message, all: options.all === true },
  });
}

export async function gitCheckoutBranch(options: {
  baseUrl: string;
  token?: string;
  branch: string;
  create?: boolean;
}): Promise<import('../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/checkout',
    body: { branch: options.branch, create: options.create === true },
  });
}

export async function fetchFileChanges(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
}): Promise<import('../shared/fileChanges.js').DesktopFileChanges> {
  const res = await fetch(`${options.baseUrl}/v1/git/file-changes`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths }),
  });
  if (!res.ok) throw new Error(`file_changes_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchFileChanges>>;
}

export function shortPath(path: string): string {
  if (!path) return '—';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join('/')}`;
}

/** Leaf folder name for workspace grouping labels. */
export function workspaceLabel(path: string): string {
  if (!path) return 'Workspace';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}
