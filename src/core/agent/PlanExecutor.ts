import type { LlmProvider } from '../llm/types';
import type { ToolDefinition } from '../llm/toolTypes';
import type { ThunderSession } from '../ThunderSession';
import type { PlanPhase, ThunderPlan } from '../planning/PlanActEngine';
import type { PlanPersistence } from '../planning/PlanPersistence';
import type { AgentLoop } from './AgentLoop';
import type { AgentLoopCallbacks } from './AgentLoop';
import type { ContextPack } from '../context/types';
import type { PostEditValidator } from '../apply/PostEditValidator';
import type { TaskAnalysis } from './TaskAnalyzer';
import {
  buildStepPrompt,
  buildPlanGenerationPrompt,
  buildRequirementAnalysisPrompt,
  buildStepRetryPrompt,
  buildFinalValidationPrompt,
} from '../planning/promptBuilder';
import { createLogger } from '../telemetry/Logger';

const log = createLogger('PlanExecutor');

export type PlanUpdateCallback = (plan: ThunderPlan) => void;

export interface PlanExecutorOptions {
  stepMaxRetries?: number;
  finalValidationEnabled?: boolean;
  agentMaxSteps?: number;
  restrictRunCommandToReadOnly?: boolean;
}

export interface StepExecutionResult {
  stepIndex: number;
  success: boolean;
  summary: string;
  touchedFiles: string[];
  validationErrors: string[];
}

export class PlanExecutor {
  private stepSummaries: string[] = [];
  private touchedFiles = new Set<string>();

  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly planPersistence: PlanPersistence,
    private readonly postEditValidator?: PostEditValidator
  ) {}

  async *analyzeRequirementsStream(
    provider: LlmProvider,
    pack: ContextPack,
    userMessage: string,
    analysis: TaskAnalysis
  ): AsyncIterable<string> {
    const messages = buildRequirementAnalysisPrompt(pack, userMessage, analysis);
    let response = '';

    for await (const delta of provider.complete({ messages, stream: true })) {
      if (delta.content) {
        response += delta.content;
        yield delta.content;
      }
      if (delta.error) throw new Error(delta.error);
    }

    if (!response.trim()) {
      yield analysis.summary;
    }
  }

  async analyzeRequirements(
    provider: LlmProvider,
    pack: ContextPack,
    userMessage: string,
    analysis: TaskAnalysis
  ): Promise<string> {
    let response = '';
    for await (const chunk of this.analyzeRequirementsStream(provider, pack, userMessage, analysis)) {
      response += chunk;
    }
    return response.trim() || analysis.summary;
  }

  async generatePlan(
    provider: LlmProvider,
    mode: ThunderSession['mode'],
    pack: ContextPack,
    userMessage: string,
    requirementAnalysis?: string
  ): Promise<ThunderPlan | null> {
    const messages = buildPlanGenerationPrompt(mode, pack, userMessage, requirementAnalysis);
    let response = '';

    for await (const delta of provider.complete({ messages, stream: false })) {
      if (delta.content) response += delta.content;
      if (delta.error) throw new Error(delta.error);
    }

    const jsonMatch =
      response.match(/```json\s*([\s\S]*?)\s*```/) ??
      response.match(/\{[\s\S]*"(?:phases|steps)"[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const raw = jsonMatch[1] ?? jsonMatch[0];
      const parsed = JSON.parse(raw) as ThunderPlan;
      if (parsed.goal && Array.isArray(parsed.phases)) {
        parsed.steps = flattenPlanPhases(parsed.phases);
      }
      if (parsed.goal && Array.isArray(parsed.steps)) {
        parsed.steps = parsed.steps.map((s, i) => ({
          ...s,
          id: s.id ?? `step-${i + 1}`,
          status: s.status ?? 'pending',
          phase: normalizePlanPhase(s.phase) ?? inferStepPhase(s.title, i),
          risk: s.risk ?? 'medium',
        }));
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }

  async *executePlan(
    session: ThunderSession,
    provider: LlmProvider,
    plan: ThunderPlan,
    pack: ContextPack,
    tools: ToolDefinition[],
    onPlanUpdate?: PlanUpdateCallback,
    signal?: AbortSignal,
    loopCallbacks?: AgentLoopCallbacks,
    options?: PlanExecutorOptions
  ): AsyncIterable<string> {
    this.stepSummaries = [];
    this.touchedFiles.clear();
    const maxRetries = options?.stepMaxRetries ?? 2;

    this.planPersistence.save(session.id, plan, 'running');
    onPlanUpdate?.(plan);

    for (let i = 0; i < plan.steps.length; i++) {
      if (signal?.aborted) break;

      const step = plan.steps[i];
      if (step.status === 'done') continue;

      let attempt = 0;
      let stepSucceeded = false;
      let lastValidationErrors: string[] = [];

      while (attempt <= maxRetries && !stepSucceeded) {
        if (signal?.aborted) break;

        if (attempt > 0) {
          yield `\n\n🔄 Retrying step ${i + 1} (attempt ${attempt + 1}/${maxRetries + 1})…\n\n`;
        } else {
          yield `\n\n### Step ${i + 1}/${plan.steps.length}: ${step.title}\n\n`;
        }

        plan.steps[i] = { ...step, status: 'running' };
        this.planPersistence.updatePlan(session.id, plan, 'running');
        onPlanUpdate?.(plan);

        const messages =
          attempt === 0
            ? buildStepPrompt(session.mode, pack, plan, step, this.stepSummaries)
            : buildStepRetryPrompt(session.mode, pack, plan, step, this.stepSummaries, lastValidationErrors);

        let stepOutput = '';
        for await (const chunk of this.agentLoop.run(
          provider,
          messages,
          tools,
          signal,
          loopCallbacks,
          {
            maxSteps: options?.agentMaxSteps,
            phaseLock: step.phase,
            restrictRunCommandToReadOnly: options?.restrictRunCommandToReadOnly,
          }
        )) {
          yield chunk;
          stepOutput += chunk;
        }

        const pendingApproval = this.agentLoop.hadPendingApproval();
        if (pendingApproval) {
          plan.steps[i] = { ...plan.steps[i], status: 'blocked' };
          this.planPersistence.updatePlan(session.id, plan, 'blocked');
          onPlanUpdate?.(plan);
          yield '\n\n⏸ Waiting for approval before continuing…\n';
          return;
        }

        if (step.files?.length) {
          for (const f of step.files) this.touchedFiles.add(f);
        }

        lastValidationErrors = await this.validateStepFiles(step.files ?? []);
        if (lastValidationErrors.length > 0) {
          attempt += 1;
          if (attempt <= maxRetries) {
            yield `\n\n⚠️ Validation errors detected — will retry:\n${lastValidationErrors.join('\n')}\n`;
            continue;
          }
          plan.steps[i] = { ...plan.steps[i], status: 'failed' };
          this.planPersistence.updatePlan(session.id, plan, 'running');
          onPlanUpdate?.(plan);
          yield `\n\n❌ Step failed after ${maxRetries + 1} attempts. Errors:\n${lastValidationErrors.join('\n')}\n`;
          break;
        }

        stepSucceeded = true;
        const summary = stepOutput.slice(-500).trim() || `Completed: ${step.title}`;
        this.stepSummaries.push(`Step ${i + 1} (${step.title}): ${summary}`);
        plan.steps[i] = { ...plan.steps[i], status: 'done' };
        this.planPersistence.updatePlan(session.id, plan, 'running');
        onPlanUpdate?.(plan);
      }
    }

    const failed = plan.steps.some((s) => s.status === 'failed');
    const blocked = plan.steps.some((s) => s.status === 'blocked');
    const allDone = plan.steps.every((s) => s.status === 'done');

    if (allDone && !blocked && options?.finalValidationEnabled !== false) {
      yield '\n\n### Final validation\n\n';
      for await (const chunk of this.runFinalValidation(
        session,
        provider,
        plan,
        pack,
        tools,
        signal,
        loopCallbacks,
        options
      )) {
        yield chunk;
      }
    }

    if (allDone) {
      this.planPersistence.complete(session.id);
      onPlanUpdate?.(plan);
      yield '\n\n✅ All steps completed.\n';
    } else if (failed) {
      yield '\n\n⚠️ Plan finished with failed steps. Review errors above and retry failed steps.\n';
    }

    log.info('Plan execution finished', {
      goal: plan.goal,
      steps: plan.steps.length,
      done: plan.steps.filter((s) => s.status === 'done').length,
      failed: plan.steps.filter((s) => s.status === 'failed').length,
    });
  }

  private async validateStepFiles(files: string[]): Promise<string[]> {
    if (!this.postEditValidator || files.length === 0) return [];

    const errors: string[] = [];
    for (const relPath of files) {
      const result = await this.postEditValidator.validate(relPath);
      if (result.errors.length > 0) {
        errors.push(this.postEditValidator.formatForAgent(result));
      }
    }
    return errors;
  }

  async *runFinalValidation(
    session: ThunderSession,
    provider: LlmProvider,
    plan: ThunderPlan,
    pack: ContextPack,
    tools: ToolDefinition[],
    signal?: AbortSignal,
    loopCallbacks?: AgentLoopCallbacks,
    options?: PlanExecutorOptions
  ): AsyncIterable<string> {
    const workspaceErrors = await this.collectWorkspaceErrors();
    const messages = buildFinalValidationPrompt(
      session.mode,
      pack,
      plan,
      this.stepSummaries,
      Array.from(this.touchedFiles),
      workspaceErrors
    );

    for await (const chunk of this.agentLoop.run(
      provider,
      messages,
      tools,
      signal,
      loopCallbacks,
      {
        maxSteps: Math.min(options?.agentMaxSteps ?? 10, 10),
        phaseLock: 'verify',
        restrictRunCommandToReadOnly: options?.restrictRunCommandToReadOnly,
      }
    )) {
      yield chunk;
    }
  }

  private async collectWorkspaceErrors(): Promise<string[]> {
    if (!this.postEditValidator) return [];

    const files = Array.from(this.touchedFiles);
    const errors: string[] = [];
    for (const relPath of files) {
      const result = await this.postEditValidator.validate(relPath);
      if (result.errors.length > 0) {
        errors.push(this.postEditValidator.formatForAgent(result));
      }
    }
    return errors;
  }

  getTouchedFiles(): string[] {
    return Array.from(this.touchedFiles);
  }
}

function flattenPlanPhases(phases: NonNullable<ThunderPlan['phases']>): ThunderPlan['steps'] {
  const steps: ThunderPlan['steps'] = [];
  for (const phase of phases) {
    const normalizedPhase = normalizePlanPhase(phase.phase) ?? inferPhaseFromTitle(phase.title);
    for (const step of phase.steps ?? []) {
      steps.push({
        id: step.id ?? `step-${steps.length + 1}`,
        title: step.title,
        status: 'pending',
        phase: normalizedPhase,
        files: step.files,
        risk: step.risk ?? 'medium',
      });
    }
  }
  return steps;
}

function normalizePlanPhase(phase: unknown): PlanPhase | undefined {
  if (phase === 'diagnostics' || phase === 'review' || phase === 'execute' || phase === 'verify') {
    return phase;
  }
  return undefined;
}

function inferStepPhase(title: string, index: number): PlanPhase {
  const text = title.toLowerCase();
  if (/\b(verify|test|lint|build|validate)\b/.test(text)) return 'verify';
  if (/\b(execute|implement|edit|patch|write|remove|update|fix)\b/.test(text)) return 'execute';
  if (/\b(review|cross-check|confirm|decide)\b/.test(text)) return 'review';
  return index === 0 ? 'diagnostics' : 'execute';
}

function inferPhaseFromTitle(title: string): PlanPhase {
  const text = title.toLowerCase();
  if (text.includes('phase 1') || text.includes('diagnostic')) return 'diagnostics';
  if (text.includes('phase 2') || text.includes('review')) return 'review';
  if (text.includes('phase 4') || text.includes('verify')) return 'verify';
  return 'execute';
}

// Re-export for backward compatibility
export { shouldDecomposeTask } from './TaskAnalyzer';
