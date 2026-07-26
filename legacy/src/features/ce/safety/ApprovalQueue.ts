import { createHash, randomUUID } from 'crypto';
import type { PolicyResult } from './ToolPolicyEngine';
import type { ThunderDb } from '../../../features/ce/indexing/ThunderDb';

export type ApprovalKind = 'mode' | 'policy' | 'mode+policy';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  inputFingerprint: string;
  inputPreview: string;
  files: string[];
  risk: 'low' | 'medium' | 'high';
  reason: string;
  policy: PolicyResult;
  createdAt: number;
  contentLength?: number;
  toolCallId?: string;
  kind?: 'approval' | 'question';
  approvalKind?: ApprovalKind;
  question?: string;
  options?: string[];
}

export type ApprovalDecision = 'approved' | 'denied';

export interface ApprovedRequest extends ApprovalRequest {
  input: Record<string, unknown>;
}

export class ApprovalQueue {
  private pending = new Map<string, ApprovalRequest>();
  private approved = new Map<string, ApprovalRequest>();
  private fullInputs = new Map<string, Record<string, unknown>>();
  private allowOnce = new Set<string>();
  private taskGrants = new Set<string>();

  constructor(private readonly db?: ThunderDb) {}

  createRequest(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    policy: PolicyResult,
    metadata?: { toolCallId?: string; approvalKind?: ApprovalKind }
  ): ApprovalRequest {
    const path = typeof input.path === 'string' ? input.path : undefined;
    const paths = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === 'string') : undefined;
    const contentLen = typeof input.content === 'string' ? input.content.length : undefined;

    const request: ApprovalRequest = {
      id: randomUUID(),
      sessionId,
      toolName,
      inputFingerprint: fingerprintApprovalInput(toolName, input),
      inputPreview: buildDisplayPreview(toolName, input),
      files: path ? [path] : paths ?? [],
      risk: toolName.includes('write') || toolName.includes('patch') || toolName === 'run_command' ? 'high' : 'medium',
      reason: policy.reason,
      policy,
      createdAt: Date.now(),
      contentLength: contentLen,
      toolCallId: metadata?.toolCallId,
      kind: toolName === 'ask_question' ? 'question' : 'approval',
      approvalKind: metadata?.approvalKind ?? 'policy',
      question: toolName === 'ask_question' && typeof input.question === 'string' ? input.question : undefined,
      options: toolName === 'ask_question' && Array.isArray(input.options)
        ? input.options.filter((o): o is string => typeof o === 'string')
        : undefined,
    };

    this.pending.set(request.id, request);
    this.fullInputs.set(request.id, input);
    return request;
  }

  getFullInput(id: string): Record<string, unknown> | undefined {
    return this.fullInputs.get(id);
  }

  resolve(id: string, decision: ApprovalDecision, reason?: string): ApprovalRequest | undefined {
    const request = this.pending.get(id);
    if (!request) return undefined;

    this.pending.delete(id);
    const fullInput = this.fullInputs.get(id);
    if (decision === 'approved' && request.kind !== 'question' && fullInput) {
      this.approved.set(id, request);
    } else {
      this.fullInputs.delete(id);
      this.approved.delete(id);
    }

    if (this.db?.tryRaw() && fullInput) {
      this.db.tryRaw()!.prepare(`
        INSERT INTO approval_audit (id, session_id, tool_name, input_json, decision, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        request.sessionId,
        request.toolName,
        JSON.stringify({ path: fullInput.path, contentLength: typeof fullInput.content === 'string' ? fullInput.content.length : 0 }),
        decision,
        reason ?? null,
        Date.now()
      );
    }

    return request;
  }

  consumeApprovedRequest(id: string): ApprovedRequest | undefined {
    const request = this.approved.get(id);
    const input = this.fullInputs.get(id);
    if (!request || !input) return undefined;
    this.approved.delete(id);
    this.fullInputs.delete(id);
    return { ...request, input };
  }

  isAllowOnce(sessionId: string, toolName: string): boolean {
    const key = `${sessionId}:${toolName}`;
    if (this.allowOnce.has(key)) {
      this.allowOnce.delete(key);
      return true;
    }
    return false;
  }

  grantForTask(sessionId: string, toolName: string, approvalKind: ApprovalKind = 'policy'): void {
    if (!sessionId || !toolName) return;
    this.taskGrants.add(buildGrantKey(sessionId, toolName, approvalKind));
  }

  hasApprovalGrant(
    sessionId: string,
    toolName: string,
    input?: Record<string, unknown>,
    approvalKind: ApprovalKind = 'policy'
  ): boolean {
    if (!sessionId || !toolName) return false;
    void input;
    if (this.taskGrants.has(buildGrantKey(sessionId, toolName, approvalKind))) return true;
    return this.isAllowOnce(sessionId, toolName);
  }

  clearTaskGrants(sessionId?: string): void {
    if (!sessionId) {
      this.taskGrants.clear();
      return;
    }
    const prefix = `${sessionId}:`;
    for (const key of [...this.taskGrants]) {
      if (key.startsWith(prefix)) {
        this.taskGrants.delete(key);
      }
    }
  }

  getPending(): ApprovalRequest[] {
    return Array.from(this.pending.values());
  }
}

export function fingerprintApprovalInput(toolName: string, input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${toolName}:${stableStringify(input)}`)
    .digest('hex');
}

function buildGrantKey(sessionId: string, toolName: string, approvalKind: ApprovalKind): string {
  return `${sessionId}:${toolName}:${approvalKind}`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function buildDisplayPreview(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'ask_question' && typeof input.question === 'string') {
    const opts = Array.isArray(input.options) ? input.options.filter((o): o is string => typeof o === 'string') : [];
    return `${input.question}${opts.length ? `\nOptions: ${opts.join(' | ')}` : ''}`;
  }
  if (toolName === 'fetch_web' && typeof input.url === 'string') {
    return `Fetch: ${input.url}`;
  }
  if (toolName === 'write_file' && typeof input.path === 'string') {
    const len = typeof input.content === 'string' ? input.content.length : 0;
    return `Write file: ${input.path} (${len.toLocaleString()} characters)`;
  }
  if (toolName === 'apply_patch' && typeof input.path === 'string') {
    return `Patch file: ${input.path}`;
  }
  if (toolName === 'read_file' && typeof input.path === 'string') {
    return `Read external file (outside workspace): ${input.path}`;
  }
  if (toolName === 'read_files' && Array.isArray(input.paths)) {
    return `Read external file(s) (outside workspace):\n${input.paths.join('\n')}`;
  }
  if (toolName === 'run_command' && typeof input.command === 'string') {
    return `Run: ${input.command.slice(0, 200)}`;
  }
  return JSON.stringify(input).slice(0, 500);
}
