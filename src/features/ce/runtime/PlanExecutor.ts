import type { AssistantStreamChunk, LlmProvider } from '../../../kernel/llm/types';
import type { ToolDefinition } from '../../../kernel/llm/toolTypes';
import { chunkContent } from '../../../kernel/llm/streamChunks';
import type { ThunderSession } from '../../../features/ce/session/ThunderSession';
import type { PlanPhase, ThunderPlan } from '../plans/PlanActEngine';
import {
  inferStepPhase,
  isPhaseLockRunCommandError,
  normalizeDeclaredStepPhase,
  normalizePlanSafety,
  resolveStepPhaseLock,
  stepImpliesWrite,
} from '../plans/PlanActEngine';
import type { PlanPersistence } from '../plans/PlanPersistence';
import type { SessionLogService } from '../../../kernel/telemetry/SessionLogService';
import type { AgentLoop } from './AgentLoop';
import type { AgentLoopCallbacks, AgentLoopSuspendState, ApprovedToolResult } from './AgentLoop';
import type { ContextPack } from '../../../features/ce/context/types';
import type { PostEditValidator } from '../apply/PostEditValidator';
import type { ToolExecutor, ToolExecutionResult } from '../safety/ToolExecutor';
import type { TaskAnalysis } from './TaskAnalyzer';
import type { AgentTaskState } from './AgentTaskState';
import { formatVerifyPlanForAgent, resolveProjectVerifyCommands } from './verifyCommandDiscovery';
import {
  buildStepPrompt,
  buildPlanGenerationPrompt,
  buildRequirementAnalysisPrompt,
  buildPlanningDiscoveryPrompt,
  buildStepRetryPrompt,
  buildFinalValidationPrompt,
  buildIsolatedPlanPrompt,
} from '../plans/promptBuilder';
import { PlanFileStore } from '../plans/PlanFileStore';
import {
  maxStepsForPlanningDepth,
  minStepsForPlanningDepth,
  resolvePlanningDepth,
  type PlanningDepth,
} from '../plans/planningDepth';
import { applyDependencyLocks, getNextExecutableStep, PLANNING_DISCOVERY_TOOLS } from '../plans/tools/planTools';
import { needsPlanGrounding } from '../modes/plan/planMode';
import { filterDirectAgentTools } from '../../../kernel/tools/toolAliases';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('PlanExecutor');

export type PlanUpdateCallback = (plan: ThunderPlan) => void;
export type { PlanningDepth };
export { resolvePlanningDepth } from '../plans/planningDepth';

export interface PlanExecutorOptions {
  stepMaxRetries?: number;
  finalValidationEnabled?: boolean;
  agentMaxSteps?: number;
  restrictRunCommandToReadOnly?: boolean;
  workspace?: string;
  useIsolatedPlanning?: boolean;
  sessionLog?: SessionLogService;
  touchedFiles?: string[];
  planAutoContinue?: boolean;
  planMaxAutoContinues?: number;
  skillPlaybookContext?: string;
  taskAnalysis?: TaskAnalysis;
  planningDepth?: PlanningDepth;
  /** Auto-approve step file paths into the session file scope before the step runs. */
  seedFileScope?: (paths: string[]) => void;
  /** Shared per-turn state used for scope and loop-local churn guards. */
  getTaskState?: () => AgentTaskState | undefined;
  onRequirementAnalysisDelta?: (text: string) => void;
  onPlanQualityIssues?: (issues: string[]) => void;
  /** When a step was blocked pending approval inside its own agent sub-loop (not an explicit
   * scripted tool call), resume that exact suspended conversation on this step's first
   * attempt instead of rebuilding the step prompt from scratch. */
  resumeStep?: { stepId: string; suspendState: AgentLoopSuspendState; approved: ApprovedToolResult[] };
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
    private readonly postEditValidator?: PostEditValidator,
    private readonly toolExecutor?: ToolExecutor
  ) {}

  async *analyzeRequirementsStream(
    provider: LlmProvider,
    pack: ContextPack,
    userMessage: string,
    analysis: TaskAnalysis,
    skillPlaybookContext?: string,
    onDelta?: (text: string) => void
  ): AsyncIterable<string> {
    log.debug('Analyzing requirements', { taskKind: analysis.kind, complexity: analysis.complexity });
    const messages = buildRequirementAnalysisPrompt(pack, userMessage, analysis, skillPlaybookContext);
    let response = '';

    for await (const delta of provider.complete({ messages, stream: true })) {
      if (delta.content) {
        response += delta.content;
        onDelta?.(response);
        yield delta.content;
      }
      if (delta.error) throw new Error(delta.error);
    }

    if (!response.trim()) {
      log.debug('Requirement analysis was empty, falling back to task summary');
      yield analysis.summary;
    }
    log.debug('Requirement analysis finished', { responseChars: response.length });
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
    requirementAnalysis?: string,
    planningDiscovery?: string,
    taskAnalysis?: TaskAnalysis,
    sessionId?: string,
    options?: PlanExecutorOptions
  ): Promise<ThunderPlan | null> {
    let repairNotes = '';
    let relaxedFallback: { plan: ThunderPlan; issues: string[] } | null = null;

    log.debug('Generating plan', {
      mode,
      sessionId,
      useIsolatedPlanning: Boolean(options?.useIsolatedPlanning),
      hasDiscovery: Boolean(planningDiscovery),
      taskKind: taskAnalysis?.kind,
    });
    const planningDepth = options?.planningDepth ?? resolvePlanningDepth(taskAnalysis);

    for (let attempt = 0; attempt < 2; attempt++) {
      log.debug('Plan generation attempt', { attempt: attempt + 1 });
      const effectiveAnalysis = repairNotes
        ? `${requirementAnalysis ?? ''}\n\n## Previous plan was rejected\n${repairNotes}\nRegenerate a valid, more specific plan.`
        : requirementAnalysis;

      const messages = options?.useIsolatedPlanning
        ? buildIsolatedPlanPrompt(
            mode,
            pack,
            userMessage,
            effectiveAnalysis,
            planningDiscovery,
            taskAnalysis ? { ...taskAnalysis, planningDepth } : undefined,
            options?.skillPlaybookContext
          )
        : buildPlanGenerationPrompt(
            mode,
            pack,
            userMessage,
            effectiveAnalysis,
            planningDiscovery,
            taskAnalysis ? { ...taskAnalysis, planningDepth } : undefined,
            options?.skillPlaybookContext
          );
      let response = '';

      for await (const delta of provider.complete({ messages, stream: false })) {
        if (delta.content) response += delta.content;
        if (delta.error) throw new Error(delta.error);
      }

      const plan = parseGeneratedPlan(response, mode);
      if (!plan) {
        log.warn('Plan response did not contain valid plan JSON', { attempt: attempt + 1, responseChars: response.length });
        repairNotes = '- Response did not contain valid plan JSON with goal and steps/phases.';
        continue;
      }

      const issues = validatePlanQuality(plan, taskAnalysis, planningDepth);
      if (issues.length === 0) {
        applyDependencyLocks(plan);
        integratePlanningDiscoveryEvidence(plan, planningDiscovery, mode);
        applyDependencyLocks(plan);
        if (sessionId && options?.workspace) {
          const fileStore = new PlanFileStore(options.workspace, sessionId);
          fileStore.save(plan, 'planning');
        }
        log.info('Plan generated successfully', { attempt: attempt + 1, goal: plan.goal, steps: plan.steps.length });
        return plan;
      }

      repairNotes = issues.map((issue) => `- ${issue}`).join('\n');
      relaxedFallback = { plan, issues };
      options?.onPlanQualityIssues?.(issues);
      log.warn('Generated plan failed quality gate', { attempt: attempt + 1, issues });
    }

    if (mode === 'plan' && relaxedFallback) {
      const plan = relaxedFallback.plan;
      plan.assumptions = [
        ...plan.assumptions,
        `Planning quality warning: ${relaxedFallback.issues.join(' ')}`,
      ];
      applyDependencyLocks(plan);
      integratePlanningDiscoveryEvidence(plan, planningDiscovery, mode);
      applyDependencyLocks(plan);
      if (sessionId && options?.workspace) {
        const fileStore = new PlanFileStore(options.workspace, sessionId);
        fileStore.save(plan, 'planning');
      }
      log.warn('Returning relaxed Plan-mode fallback after quality gate rejection', {
        issues: relaxedFallback.issues,
        stepCount: plan.steps.length,
      });
      return plan;
    }

    log.warn('Plan generation failed after all attempts', { mode, hadRelaxedFallback: Boolean(relaxedFallback) });
    return null;
  }

  async runPlanningDiscovery(
    provider: LlmProvider,
    mode: ThunderSession['mode'],
    pack: ContextPack,
    userMessage: string,
    analysis: TaskAnalysis,
    tools: ToolDefinition[],
    signal?: AbortSignal,
    loopCallbacks?: AgentLoopCallbacks,
    options?: PlanExecutorOptions
  ): Promise<string> {
    const messages = buildPlanningDiscoveryPrompt(
      mode,
      pack,
      userMessage,
      analysis,
      {
        skillPlaybookContext: options?.skillPlaybookContext,
        docsMode: isDocumentationPlan(analysis),
        subagentsEnabled: analysis.shouldUseSubagents,
      }
    );
    const readOnlyTools = tools
      .filter((tool) => PLANNING_DISCOVERY_TOOLS.has(tool.function.name))
      .filter((tool) => analysis.shouldUseSubagents || !['spawn_research_agent', 'spawn_subagent'].includes(tool.function.name));
    let output = '';
    const toolEvidence: string[] = [];
    const toolInputs: Array<{ name: string; input: Record<string, unknown> }> = [];
    const discoveryCallbacks: AgentLoopCallbacks = {
      ...loopCallbacks,
      onToolStart: (name, input) => {
        toolInputs.push({ name, input });
        loopCallbacks?.onToolStart?.(name, input);
      },
      onToolEnd: (name, success, toolOutput, durationMs) => {
        loopCallbacks?.onToolEnd?.(name, success, toolOutput, durationMs);
        const input = [...toolInputs].reverse().find((candidate) => candidate.name === name)?.input;
        toolEvidence.push(formatPlanningDiscoveryToolEvidence(name, input, success, toolOutput));
        while (toolEvidence.join('\n').length > 12_000 && toolEvidence.length > 1) {
          toolEvidence.shift();
        }
      },
    };

    log.debug('Running planning discovery', {
      mode,
      readOnlyToolCount: readOnlyTools.length,
      maxSteps: Math.min(options?.agentMaxSteps ?? 8, 12),
      requiresPlanGrounding: mode === 'plan' && needsPlanGrounding(userMessage),
    });

    for await (const chunk of this.agentLoop.run(
      provider,
      messages,
      readOnlyTools,
      signal,
      discoveryCallbacks,
      {
        maxSteps: Math.min(options?.agentMaxSteps ?? 8, 12),
        phaseLock: 'diagnostics',
        restrictRunCommandToReadOnly: true,
        planMode: mode === 'plan',
        requiresPlanGrounding: mode === 'plan' && needsPlanGrounding(userMessage),
        autoContinue: options?.planAutoContinue ?? true,
        maxAutoContinues: options?.planMaxAutoContinues ?? 1,
      }
    )) {
      output += chunkContent(chunk);
      if (output.length > 12_000) {
        output = output.slice(-12_000);
      }
      if (signal?.aborted) break;
    }

    log.debug('Planning discovery finished', { outputChars: output.length, aborted: Boolean(signal?.aborted) });
    return mergePlanningDiscoveryOutput(output, toolEvidence);
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
  ): AsyncIterable<AssistantStreamChunk> {
    this.stepSummaries = [];
    this.touchedFiles.clear();
    const maxRetries = options?.stepMaxRetries ?? 2;
    let hasSuccessfulVerification = false;
    let stalledByDependencies = false;

    log.debug('Starting plan execution', { goal: plan.goal, steps: plan.steps.length, maxRetries });

    // Re-open steps left blocked/running by an interrupted execution so the DAG
    // selector can resume them as executable pending work.
    for (let si = 0; si < plan.steps.length; si++) {
      if (plan.steps[si].status === 'blocked' || plan.steps[si].status === 'running') {
        plan.steps[si] = { ...plan.steps[si], status: 'pending' };
      }
    }

    this.planPersistence.save(session.id, plan, 'running');
    this.syncPlanFile(options?.workspace, session.id, plan, 'running');
    onPlanUpdate?.(plan);

    applyDependencyLocks(plan);

    for (let i = 0; i < plan.steps.length; i++) {
      if (signal?.aborted) break;

      const step = getNextExecutableStep(plan);
      if (!step) {
        if (!plan.steps.every((candidate) => candidate.status === 'done')) {
          stalledByDependencies = true;
          yield '\n\n⚠️ Plan stopped because no executable step remains; pending steps have failed or unmet dependencies.\n';
        }
        break;
      }
      const stepIndex = plan.steps.findIndex((s) => s.id === step.id);
      if (stepIndex < 0 || step.status === 'done') continue;
      i = stepIndex;

      log.debug('Executing step', { stepId: step.id, stepIndex: i + 1, title: step.title, phase: step.phase });

      let attempt = 0;
      let stepSucceeded = false;
      let lastValidationErrors: string[] = [];

      while (attempt <= maxRetries && !stepSucceeded) {
        if (signal?.aborted) break;

        if (attempt > 0) {
          yield `\n\nRetrying step ${i + 1}/${plan.steps.length} (${attempt + 1}/${maxRetries + 1})…\n\n`;
        } else {
          yield `\n\n### Step ${i + 1}/${plan.steps.length}: ${step.title}\n\n`;
        }

        plan.steps[i] = { ...step, status: 'running' };
        this.planPersistence.updatePlan(session.id, plan, 'running');
        this.syncPlanFile(options?.workspace, session.id, plan, 'running');
        onPlanUpdate?.(plan);

        const stepStartedAt = Date.now();
        const phaseLock = resolveStepPhaseLock(step, session.mode);
        const isVerifyStep = phaseLock === 'verify' || /\b(verify|verification|lint|build|validate|test)\b/i.test(step.title);
        const verifyContextBlock =
          isVerifyStep && options?.workspace
            ? formatVerifyPlanForAgent(
                resolveProjectVerifyCommands(options.workspace, [], {
                  touchedFiles: [...this.touchedFiles],
                  userMessage: plan.goal,
                })
              )
            : undefined;
        const messages =
          attempt === 0
            ? buildStepPrompt(session.mode, pack, plan, step, this.stepSummaries, verifyContextBlock, {
                skillPlaybookContext: options?.skillPlaybookContext,
                auditMode: options?.restrictRunCommandToReadOnly,
                docsMode: isDocumentationPlan(options?.taskAnalysis, plan.goal),
              })
            : buildStepRetryPrompt(
                session.mode,
                pack,
                plan,
                step,
                this.stepSummaries,
                lastValidationErrors,
                verifyContextBlock,
                {
                  skillPlaybookContext: options?.skillPlaybookContext,
                  auditMode: options?.restrictRunCommandToReadOnly,
                  docsMode: isDocumentationPlan(options?.taskAnalysis, plan.goal),
                }
              );

        if (attempt === 0 && step.files?.length && options?.seedFileScope) {
          options.seedFileScope(step.files);
        }

        let stepOutput = '';
        let successfulWrites = 0;
        let successfulVerifyCommands = 0;
        let failedVerifyCommands = 0;
        let diagnosticFailureCaptures = 0;
        let toolCallCount = 0;
        let toolCallSuccessCount = 0;
        let pendingApproval = false;
        const explicitToolCall = getExplicitStepToolCall(step);
        const writeExpected = stepImpliesWrite(step) && session.mode === 'agent' && !explicitToolCall;

        if (explicitToolCall && this.toolExecutor) {
          const toolStartedAt = Date.now();
          loopCallbacks?.onToolStart?.(explicitToolCall.name, explicitToolCall.input);
          const execResult = await this.toolExecutor.execute(explicitToolCall.name, explicitToolCall.input, {
            phaseLock,
            restrictRunCommandToReadOnly: options?.restrictRunCommandToReadOnly,
          });
          const output = summarizeToolExecution(explicitToolCall.name, execResult);
          loopCallbacks?.onToolEnd?.(explicitToolCall.name, execResult.success, output, Date.now() - toolStartedAt);
          stepOutput += output;
          yield output;

          if (execResult.pendingApproval) {
            log.debug('Step blocked pending approval', { stepId: step.id, tool: explicitToolCall.name });
            plan.steps[i] = { ...plan.steps[i], status: 'blocked' };
            this.planPersistence.updatePlan(session.id, plan, 'blocked');
            this.syncPlanFile(options?.workspace, session.id, plan, 'blocked');
            onPlanUpdate?.(plan);
            yield '\n\n⏸ Waiting for approval before continuing…\n';
            return;
          }

          if (!execResult.success) {
            const failureDetail = execResult.error ?? execResult.output;
            lastValidationErrors = [`${explicitToolCall.name} failed: ${failureDetail}`];
            if (isExpectedDiagnosticFailureCapture(step, explicitToolCall.name, execResult)) {
              log.debug('Treating failed diagnostic command as captured reproduction evidence', {
                stepId: step.id,
                tool: explicitToolCall.name,
              });
              const captureMessage = '\n\nDiagnostic failing signal captured; continuing with captured output.\n';
              stepOutput += captureMessage;
              yield captureMessage;
            } else {
              if (
                explicitToolCall.name === 'run_command' &&
                isPhaseLockRunCommandError(failureDetail)
              ) {
                plan.steps[i] = { ...plan.steps[i], status: 'failed' };
                this.planPersistence.updatePlan(session.id, plan, 'running');
                onPlanUpdate?.(plan);
                yield `\n\nStep ${i + 1} was rejected by the phase policy and will not be retried unchanged.\n`;
                break;
              }
              attempt += 1;
              if (attempt <= maxRetries) {
                log.debug('Step tool failed, retrying', { stepId: step.id, tool: explicitToolCall.name, attempt: attempt + 1 });
                yield `\n\nStep tool did not complete. Retrying step ${i + 1}/${plan.steps.length} (${attempt + 1}/${maxRetries + 1})…\n`;
                plan.steps[i] = { ...plan.steps[i], status: 'pending' };
                continue;
              }
              plan.steps[i] = { ...plan.steps[i], status: 'failed' };
              this.planPersistence.updatePlan(session.id, plan, 'running');
              onPlanUpdate?.(plan);
              log.warn('Step failed after max retries', { stepId: step.id, tool: explicitToolCall.name, errors: lastValidationErrors });
              yield `\n\n❌ Step failed after ${maxRetries + 1} attempts. Errors:\n${lastValidationErrors.join('\n')}\n`;
              break;
            }
          }

          if (['write_file', 'apply_patch'].includes(explicitToolCall.name)) {
            successfulWrites += 1;
          }
          if (isVerifyStep && isVerificationTool(explicitToolCall.name)) {
            hasSuccessfulVerification = true;
            successfulVerifyCommands += 1;
          }
        } else {
          const toolInputs: Array<{ name: string; input: Record<string, unknown> }> = [];
          const stepCallbacks: AgentLoopCallbacks = {
            ...loopCallbacks,
            onToolStart: (name, input) => {
              toolInputs.push({ name, input });
              loopCallbacks?.onToolStart?.(name, input);
            },
            onToolEnd: (name, success, output) => {
              loopCallbacks?.onToolEnd?.(name, success, output);
              toolCallCount += 1;
              if (success) toolCallSuccessCount += 1;
              const input = [...toolInputs].reverse().find((candidate) => candidate.name === name)?.input;
              const capturedDiagnosticFailure =
                !success &&
                isExpectedDiagnosticFailureCapture(
                  step,
                  name,
                  { success: false, output: output ?? '', error: output ?? '' },
                  input
                );
              if (capturedDiagnosticFailure) {
                diagnosticFailureCaptures += 1;
              }
              if (success && ['write_file', 'apply_patch'].includes(name)) {
                successfulWrites += 1;
              }
              if (
                isVerifyStep &&
                success &&
                isVerificationTool(name) &&
                !/\bSkipped redundant\b/i.test(output ?? '')
              ) {
                hasSuccessfulVerification = true;
                successfulVerifyCommands += 1;
              }
              if (
                isVerifyStep &&
                name === 'run_command' &&
                !success &&
                !capturedDiagnosticFailure &&
                !/\bSkipped redundant\b/i.test(output ?? '')
              ) {
                failedVerifyCommands += 1;
              }
            },
          };

          // A step blocked mid-sub-loop pending approval has its exact conversation preserved
          // in `resumeStep.suspendState` — continue there on the first attempt instead of
          // re-entering with a fresh prompt, which would otherwise re-run discovery the step
          // already completed before the approval gate.
          const resumingThisStep = attempt === 0 && options?.resumeStep?.stepId === step.id;
          const stepStream = resumingThisStep && options?.resumeStep
            ? this.agentLoop.resume(provider, options.resumeStep.suspendState, options.resumeStep.approved, signal, stepCallbacks)
            : this.agentLoop.run(
                provider,
                messages,
                filterToolsForPlanPhase(filterDirectAgentTools(tools), phaseLock),
                signal,
                stepCallbacks,
                {
                  maxSteps: options?.agentMaxSteps,
                  phaseLock,
                  restrictRunCommandToReadOnly: options?.restrictRunCommandToReadOnly,
                  planTracker: plan,
                  getTaskState: options?.getTaskState,
                }
              );

          for await (const chunk of stepStream) {
            yield chunk;
            stepOutput += chunkContent(chunk);
          }
          pendingApproval = this.agentLoop.hadPendingApproval();
        }

        if (pendingApproval) {
          log.debug('Step blocked pending approval', { stepId: step.id });
          plan.steps[i] = { ...plan.steps[i], status: 'blocked' };
          this.planPersistence.updatePlan(session.id, plan, 'blocked');
          this.syncPlanFile(options?.workspace, session.id, plan, 'blocked');
          onPlanUpdate?.(plan);
          yield '\n\n⏸ Waiting for approval before continuing…\n';
          return;
        }

        if (successfulWrites > 0 && step.files?.length) {
          for (const f of step.files) this.touchedFiles.add(f);
        }

        if (writeExpected && successfulWrites === 0 && !pendingApproval) {
          lastValidationErrors = [
            'This step requires file edits (write_file/apply_patch) but no writes succeeded.',
            phaseLock === 'execute'
              ? 'Review tool errors above and retry with a complete patch or write_file.'
              : `Step was locked to ${phaseLock ?? 'unknown'} phase — writes may have been blocked.`,
          ];
          attempt += 1;
          if (attempt <= maxRetries) {
            yield `\n\nNo file changes were applied yet. Retrying step ${i + 1}/${plan.steps.length} (${attempt + 1}/${maxRetries + 1})…\n`;
            plan.steps[i] = { ...plan.steps[i], status: 'pending' };
            continue;
          }
        }

        const shouldValidateStepFiles = successfulWrites > 0 || writeExpected;
        lastValidationErrors = shouldValidateStepFiles
          ? await this.validateStepFiles(step.files ?? [])
          : [];
        if (lastValidationErrors.length > 0) {
          attempt += 1;
          if (attempt <= maxRetries) {
            yield `\n\n⚠️ Validation errors detected — will retry:\n${lastValidationErrors.join('\n')}\n`;
            continue;
          }
          plan.steps[i] = { ...plan.steps[i], status: 'failed' };
          this.planPersistence.updatePlan(session.id, plan, 'running');
          onPlanUpdate?.(plan);
          log.warn('Step failed validation after max retries', { stepId: step.id, errors: lastValidationErrors });
          yield `\n\n❌ Step failed after ${maxRetries + 1} attempts. Errors:\n${lastValidationErrors.join('\n')}\n`;
          break;
        }

        if (isVerifyStep && failedVerifyCommands > 0) {
          lastValidationErrors = [
            `Verification commands failed ${failedVerifyCommands} time(s). Fix reported errors before completing this step.`,
            'Read package.json scripts first — do not assume npm run lint exists.',
          ];
          attempt += 1;
          if (attempt <= maxRetries) {
            yield `\n\n⚠️ Verification failed — retrying step ${i + 1}/${plan.steps.length} (${attempt + 1}/${maxRetries + 1})…\n`;
            plan.steps[i] = { ...plan.steps[i], status: 'pending' };
            continue;
          }
          plan.steps[i] = { ...plan.steps[i], status: 'failed' };
          this.planPersistence.updatePlan(session.id, plan, 'running');
          onPlanUpdate?.(plan);
          log.warn('Verification step failed after max retries', { stepId: step.id, failedVerifyCommands });
          yield `\n\n❌ Verification step failed after ${maxRetries + 1} attempts.\n`;
          break;
        }

        if (isVerifyStep && successfulVerifyCommands === 0 && diagnosticFailureCaptures === 0) {
          lastValidationErrors = [
            'This verification step did not run a successful diagnostics, typecheck, lint, test, or build tool.',
            'Do not complete verification from prose alone; run the narrowest relevant command.',
          ];
          attempt += 1;
          if (attempt <= maxRetries) {
            yield `\n\n⚠️ No verification command completed — retrying step ${i + 1}/${plan.steps.length} (${attempt + 1}/${maxRetries + 1})…\n`;
            plan.steps[i] = { ...plan.steps[i], status: 'pending' };
            continue;
          }
          plan.steps[i] = { ...plan.steps[i], status: 'failed' };
          this.planPersistence.updatePlan(session.id, plan, 'running');
          onPlanUpdate?.(plan);
          yield `\n\n❌ Verification step failed after ${maxRetries + 1} attempts without a successful verification command.\n`;
          break;
        }

        // Generic steps (no explicit write/verify expectation) have no other completion gate
        // above, so without this check a step whose tool calls all failed would still be
        // marked done purely because the model stopped emitting tool calls — completion must
        // be tied to a tool actually succeeding, not to the model's narration ending.
        const isGenericStep = !writeExpected && !isVerifyStep && !explicitToolCall;
        if (isGenericStep && toolCallCount > 0 && toolCallSuccessCount === 0) {
          lastValidationErrors = [
            'This step ran one or more tool calls, but none of them completed successfully.',
            'Do not report this step as complete from narration alone — retry the underlying tool call or adjust the approach.',
          ];
          attempt += 1;
          if (attempt <= maxRetries) {
            yield `\n\n⚠️ No tool call in this step succeeded — retrying step ${i + 1}/${plan.steps.length} (${attempt + 1}/${maxRetries + 1})…\n`;
            plan.steps[i] = { ...plan.steps[i], status: 'pending' };
            continue;
          }
          plan.steps[i] = { ...plan.steps[i], status: 'failed' };
          this.planPersistence.updatePlan(session.id, plan, 'running');
          onPlanUpdate?.(plan);
          log.warn('Step failed: no tool call succeeded', { stepId: step.id, toolCallCount });
          yield `\n\n❌ Step failed after ${maxRetries + 1} attempts — no tool call succeeded.\n`;
          break;
        }

        stepSucceeded = true;
        const summary = summarizeStepOutput(stepOutput, step.title);
        this.stepSummaries.push(`Step ${i + 1} (${step.title}): ${summary}`);
        plan.steps[i] = { ...plan.steps[i], status: 'done' };
        const stepDurationMs = Date.now() - stepStartedAt;
        log.debug('Step completed', { stepId: step.id, stepIndex: i + 1, durationMs: stepDurationMs, attempt: attempt + 1 });
        options?.sessionLog?.appendTiming(`plan_step:${step.id}`, stepDurationMs, {
          title: step.title,
          stepIndex: i + 1,
          success: true,
          verifyFailures: failedVerifyCommands,
        });
        options?.sessionLog?.append('plan_step', step.title, {
          stepId: step.id,
          stepIndex: i + 1,
          status: 'done',
          durationMs: stepDurationMs,
        });
        this.planPersistence.updatePlan(session.id, plan, 'running');
        if (options?.workspace) {
          new PlanFileStore(options.workspace, session.id).markStepComplete(step.id);
        }
        onPlanUpdate?.(plan);
      }
    }

    const failed = plan.steps.some((s) => s.status === 'failed');
    const blocked = plan.steps.some((s) => s.status === 'blocked');
    const allDone = plan.steps.every((s) => s.status === 'done');

    if (allDone && !blocked && !hasSuccessfulVerification && options?.finalValidationEnabled !== false) {
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
    } else if (failed || stalledByDependencies) {
      yield '\n\n⚠️ Plan finished with failed steps. Review errors above and retry failed steps.\n';
    }

    log.info('Plan execution finished', {
      goal: plan.goal,
      steps: plan.steps.length,
      done: plan.steps.filter((s) => s.status === 'done').length,
      failed: plan.steps.filter((s) => s.status === 'failed').length,
    });
  }

  private syncPlanFile(
    workspace: string | undefined,
    sessionId: string,
    plan: ThunderPlan,
    status: 'planning' | 'running' | 'blocked' | 'completed' | 'failed'
  ): void {
    if (!workspace) return;
    try {
      new PlanFileStore(workspace, sessionId).save(plan, status);
    } catch (error) {
      log.warn('Failed to sync plan file', { error: String(error) });
    }
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
  ): AsyncIterable<AssistantStreamChunk> {
    const touchedFiles = options?.touchedFiles ?? Array.from(this.touchedFiles);
    const workspaceErrors = await this.collectWorkspaceErrors(touchedFiles);
    const verifyContextBlock = options?.workspace
      ? formatVerifyPlanForAgent(
          resolveProjectVerifyCommands(options.workspace, [], {
            touchedFiles,
            userMessage: plan.goal,
          })
        )
      : undefined;
    const messages = buildFinalValidationPrompt(
      session.mode,
      pack,
      plan,
      this.stepSummaries,
      touchedFiles,
      workspaceErrors,
      verifyContextBlock,
      {
        skillPlaybookContext: options?.skillPlaybookContext,
        auditMode: options?.restrictRunCommandToReadOnly,
        docsMode: isDocumentationPlan(undefined, plan.goal),
      }
    );

    for await (const chunk of this.agentLoop.run(
      provider,
      messages,
      filterToolsForPlanPhase(tools, 'verify'),
      signal,
      loopCallbacks,
      {
        maxSteps: Math.min(options?.agentMaxSteps ?? 10, 10),
        phaseLock: 'verify',
        restrictRunCommandToReadOnly: options?.restrictRunCommandToReadOnly,
        getTaskState: options?.getTaskState,
      }
    )) {
      yield chunk;
    }
  }

  private async collectWorkspaceErrors(files = Array.from(this.touchedFiles)): Promise<string[]> {
    if (!this.postEditValidator) return [];

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

function flattenPlanPhases(
  phases: NonNullable<ThunderPlan['phases']>,
  mode: ThunderSession['mode']
): ThunderPlan['steps'] {
  const steps: ThunderPlan['steps'] = [];
  for (const phase of phases) {
    const declaredPhase = normalizePlanPhase(phase.phase) ?? inferPhaseFromTitle(phase.title);
    for (const step of phase.steps ?? []) {
      const objective = step.objective ?? phase.objective;
      steps.push({
        id: step.id ?? `step-${steps.length + 1}`,
        title: step.title,
        status: 'pending',
        phase: normalizeDeclaredStepPhase({
          title: step.title,
          objective,
          phase: declaredPhase,
          tools: normalizeStringArray(step.tools),
          files: step.files,
        }, steps.length, mode),
        objective,
        tool: step.tool,
        args: step.args,
        script: step.script,
        dependsOn: step.dependsOn,
        tools: normalizeStringArray(step.tools),
        successCriteria: normalizeStringArray(step.successCriteria),
        files: step.files,
        risk: step.risk ?? 'medium',
      });
    }
  }
  return steps;
}

function formatPlanningDiscoveryToolEvidence(
  name: string,
  input: Record<string, unknown> | undefined,
  success: boolean,
  output: string
): string {
  const command =
    typeof input?.command === 'string'
      ? input.command
      : typeof input?.script === 'string'
        ? input.script
        : undefined;
  const target = typeof input?.path === 'string' ? input.path : undefined;
  const descriptor = command ? ` (${command})` : target ? ` (${target})` : '';
  const trimmed = output.trim();
  const capped = trimmed.length > 1800 ? trimmed.slice(-1800) : trimmed;
  return `- ${name}${descriptor} ${success ? 'succeeded' : 'failed'}${capped ? `: ${capped}` : ''}`;
}

function mergePlanningDiscoveryOutput(output: string, toolEvidence: string[]): string {
  const prose = output.trim();
  const evidence = toolEvidence.map((item) => item.trim()).filter(Boolean);
  if (evidence.length === 0) return prose;

  const merged = [
    prose || 'DISCOVERY_SUMMARY: Tool-assisted discovery produced the following evidence.',
    'DISCOVERY_TOOL_EVIDENCE:',
    ...evidence,
  ].join('\n');
  return merged.length > 12_000 ? merged.slice(-12_000).trim() : merged;
}

function integratePlanningDiscoveryEvidence(
  plan: ThunderPlan,
  planningDiscovery: string | undefined,
  mode: ThunderSession['mode']
): void {
  if (mode !== 'agent') return;
  if (!hasCapturedFailingVerificationSignal(planningDiscovery)) return;

  const duplicate = plan.steps.find((step) =>
    step.status !== 'done' &&
    isDiagnosticFailureCaptureStep(step)
  );
  if (!duplicate) return;

  duplicate.status = 'done';
  const note = `Planning discovery already captured the failing build/typecheck/test signal; skipped duplicate reproduction step ${duplicate.id}.`;
  if (!plan.assumptions.includes(note)) {
    plan.assumptions = [...plan.assumptions, note];
  }
}

function isExpectedDiagnosticFailureCapture(
  step: ThunderPlan['steps'][number],
  toolName: string,
  result: ToolExecutionResult,
  input?: Record<string, unknown>
): boolean {
  if (!['run_command', 'execute_workspace_script'].includes(toolName)) return false;
  const failureDetail = `${result.error ?? ''}\n${result.output ?? ''}`;
  if (isPhaseLockRunCommandError(failureDetail)) return false;
  const command =
    typeof input?.command === 'string'
      ? input.command
      : typeof input?.script === 'string'
        ? input.script
        : '';
  const signalContext = `${step.title}\n${step.objective ?? ''}\n${step.script?.command ?? ''}\n${command}\n${failureDetail}`;
  return isDiagnosticFailureCaptureStep(step) && hasCapturedFailingVerificationSignal(signalContext);
}

function isDiagnosticFailureCaptureStep(step: ThunderPlan['steps'][number]): boolean {
  if (step.phase && !['diagnostics', 'review'].includes(step.phase)) return false;
  const text = `${step.title} ${step.objective ?? ''} ${step.successCriteria?.join(' ') ?? ''}`.toLowerCase();
  const tools = step.tools ?? [];
  const usesDiagnosticTool =
    tools.length === 0 ||
    tools.some((tool) => ['run_command', 'execute_workspace_script', 'diagnostics'].includes(tool)) ||
    Boolean(step.script?.command);
  if (!usesDiagnosticTool) return false;

  return (
    /\b(reproduce|capture|captured|collect|establish|read|inspect|analy[sz]e|identify)\b[\s\S]*\b(fail|failing|failure|error|errors|build|typecheck|compile|test|lint|signal)\b/i.test(text) ||
    /\b(run|rerun|execute)\b[\s\S]*\b(build|typecheck|compile|test|lint)\b[\s\S]*\b(capture|initial|fail|failing|failure|error|signal)\b/i.test(text)
  );
}

function hasCapturedFailingVerificationSignal(text: string | undefined): boolean {
  if (!text) return false;
  const hasVerificationCommand =
    /\b(build|typecheck|tsc|compile|lint|test|pnpm\s+run|npm\s+run|yarn\s+(?:run\s+)?)\b/i.test(text);
  const hasFailure =
    /\b(error TS\d+|Command failed|failed|failure|ERR_|FAIL\b|exit code [1-9]\d*)\b/i.test(text);
  return hasVerificationCommand && hasFailure;
}

function parseGeneratedPlan(response: string, mode: ThunderSession['mode'] = 'plan'): ThunderPlan | null {
  const jsonMatch =
    response.match(/```json\s*([\s\S]*?)\s*```/) ??
    response.match(/\{[\s\S]*"(?:phases|steps)"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const raw = jsonMatch[1] ?? jsonMatch[0];
    const parsed = JSON.parse(raw) as ThunderPlan;
    if (parsed.goal && Array.isArray(parsed.phases)) {
      parsed.steps = flattenPlanPhases(parsed.phases, mode);
    }
    if (parsed.goal && Array.isArray(parsed.steps)) {
      parsed.assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
      parsed.requiredApprovals = Array.isArray(parsed.requiredApprovals) ? parsed.requiredApprovals : [];
      parsed.steps = parsed.steps.map((s, i) => ({
        ...s,
        id: s.id ?? `step-${i + 1}`,
        status: s.status ?? 'pending',
        phase: normalizeDeclaredStepPhase({
          title: s.title,
          objective: typeof s.objective === 'string' ? s.objective : undefined,
          phase: normalizePlanPhase(s.phase) ?? inferStepPhase(s.title, i),
          tools: normalizeStringArray(s.tools),
          files: normalizeStringArray(s.files),
        }, i, mode),
        objective: typeof s.objective === 'string' ? s.objective : undefined,
        tool: typeof s.tool === 'string' ? s.tool : undefined,
        args: typeof s.args === 'object' && s.args !== null ? s.args as Record<string, unknown> : undefined,
        script: normalizeStepScript((s as ThunderPlan['steps'][number]).script),
        dependsOn: normalizeStringArray(s.dependsOn),
        tools: normalizeStringArray(s.tools),
        successCriteria: normalizeStringArray(s.successCriteria),
        files: normalizeStringArray(s.files),
        risk: normalizeRisk(s.risk),
      }));
      applyDependencyLocks(parsed);
      return normalizePlanSafety(parsed);
    }
  } catch {
    return null;
  }
  return null;
}

function validatePlanQuality(
  plan: ThunderPlan,
  taskAnalysis?: TaskAnalysis,
  planningDepth: PlanningDepth = resolvePlanningDepth(taskAnalysis)
): string[] {
  const issues: string[] = [];
  const stepCount = plan.steps.length;
  const phases = new Set(plan.steps.map((step) => step.phase).filter(Boolean));

  if (stepCount < 1) issues.push('Plan must contain at least one step.');
  const maxSteps = maxStepsForPlanningDepth(planningDepth, taskAnalysis);
  if (maxSteps && stepCount > maxSteps) {
    issues.push(`Plan has ${stepCount} steps, but ${planningDepth} planning allows at most ${maxSteps} steps. Merge duplicate discovery/verification work.`);
  }

  const minSteps = minStepsForPlanningDepth(planningDepth, taskAnalysis);
  if (stepCount < minSteps) {
    issues.push(
      `Plans at ${planningDepth} depth must contain at least ${minSteps} step${minSteps === 1 ? '' : 's'}.`
    );
  }

  const cleanupAudit =
    taskAnalysis?.kind === 'audit' &&
    (!taskAnalysis.auditSubtype ||
      taskAnalysis.auditSubtype === 'unused_deps' ||
      taskAnalysis.auditSubtype === 'dead_code' ||
      taskAnalysis.auditSubtype === 'vulnerability' ||
      taskAnalysis.auditSubtype === 'generic');

  if (cleanupAudit) {
    for (const phase of ['diagnostics', 'review', 'execute', 'verify'] as const) {
      if (!phases.has(phase)) issues.push(`Dependency/dead-code audit plans must include a ${phase} phase.`);
    }
  }

  if (isDocumentationPlan(taskAnalysis)) {
    const planText = plan.steps
      .map((step) => [
        step.title,
        step.objective,
        step.tools?.join(' '),
        step.successCriteria?.join(' '),
        step.files?.join(' '),
      ].filter(Boolean).join(' '))
      .join('\n')
      .toLowerCase();

    const docsSubtype = taskAnalysis?.docsSubtype;
    const isReadme = docsSubtype === 'readme' || /\breadme\b/i.test(taskAnalysis?.summary ?? '');
    const isDocusaurus =
      docsSubtype === 'docusaurus' ||
      docsSubtype === 'mdx_repair' ||
      /\b(docusaurus|mdx)\b/i.test(taskAnalysis?.summary ?? '');

    if (isDocusaurus) {
      if (!/(docusaurus\.config|sidebars?|navbar|routebasepath|sidebarpath|docspluginid|docs plugin|docs routing)/i.test(planText)) {
        issues.push('Docusaurus documentation plans must inspect/update docs routing/config such as docusaurus.config.ts, sidebars, navbar, or docs plugin settings.');
      }
      if (!phases.has('verify') && !/\b(build|validate|verify|test)\b/.test(planText)) {
        issues.push('Docusaurus documentation plans must include a verification step, such as running the docs build.');
      }
    } else if (isReadme) {
      if (!/\b(readme|structure|api|architecture|payload)\b/i.test(planText)) {
        issues.push('README documentation plans must cover structure/API/architecture content discovery and writing.');
      }
      // README plans must NOT require Docusaurus routing or full app builds.
    } else {
      if (!phases.has('verify') && !/\b(build|validate|verify|read|review)\b/.test(planText)) {
        issues.push('Documentation plans must include a verification or review step.');
      }
    }
  }

  const vagueSteps = plan.steps.filter((step) => step.title.trim().split(/\s+/).length < 3);
  if (vagueSteps.length > 0) {
    issues.push(`Step titles are too vague: ${vagueSteps.map((step) => step.id).join(', ')}.`);
  }

  const missingExecutionDetail = plan.steps.filter(
    (step) => !step.objective || !step.tools?.length || !step.successCriteria?.length
  );
  if (taskAnalysis?.kind === 'audit' && missingExecutionDetail.length > 0) {
    issues.push(`Audit steps must include objective, tools, and successCriteria: ${missingExecutionDetail.map((step) => step.id).join(', ')}.`);
  }

  const missingVerification = plan.steps.filter(
    (step) => !step.successCriteria?.some((criterion) => /\b(verify|test|lint|build|validate|pass)\b/i.test(criterion))
  );
  if (
    (taskAnalysis?.shouldPlan || taskAnalysis?.complexity === 'high') &&
    missingVerification.length === plan.steps.length &&
    plan.steps.length >= 3
  ) {
    issues.push('Planned tasks should include verification-oriented successCriteria on at least one step.');
  }

  return issues;
}

function isDocumentationPlan(taskAnalysis?: TaskAnalysis, fallbackText = ''): boolean {
  const text = `${taskAnalysis?.summary ?? ''} ${fallbackText}`;
  return Boolean(
    taskAnalysis?.kind === 'docs' ||
    taskAnalysis?.planIntent === 'docs' ||
    taskAnalysis?.actIntent === 'docs' ||
    (taskAnalysis?.kind === 'implementation' && /\b(documentation|docs?|docusaurus|mdx|readme)\b/i.test(text))
  );
}

function filterToolsForPlanPhase<T extends { function: { name: string } }>(
  tools: T[],
  phase: PlanPhase | undefined
): T[] {
  if (!phase) return tools;
  const hiddenInReadOnly = new Set([
    'write_file',
    'apply_patch',
    'memory_write',
    'save_task_state',
  ]);
  const hiddenMcpWrite = /^mcp__filesystem__(create_directory|move_file|write_file|edit_file)$/i;

  return tools.filter((tool) => {
    const name = tool.function.name;
    if (phase === 'diagnostics' || phase === 'review') {
      if (hiddenInReadOnly.has(name)) return false;
      if (hiddenMcpWrite.test(name)) return false;
    }
    if (phase === 'verify' && hiddenMcpWrite.test(name)) return false;
    // Plan-control and release tools are orchestrator-owned / git-route-only.
    if (name === 'mark_step_complete' || name === 'propose_plan_mutation' || name === 'release_plan_controller') {
      return false;
    }
    // Prefer builtin FS over MCP duplicates during plan execution.
    if (name.startsWith('mcp__filesystem__')) return false;
    return true;
  });
}

function normalizeRisk(risk: unknown): 'low' | 'medium' | 'high' {
  if (risk === 'low' || risk === 'medium' || risk === 'high') return risk;
  return 'medium';
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStepScript(value: unknown): { command?: string; args?: unknown[] } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const script = value as { command?: unknown; args?: unknown };
  const command = typeof script.command === 'string' && script.command.trim() ? script.command.trim() : undefined;
  const args = Array.isArray(script.args) ? script.args : undefined;
  return command || args ? { command, args } : undefined;
}

function getExplicitStepToolCall(
  step: ThunderPlan['steps'][number]
): { name: string; input: Record<string, unknown> } | null {
  if (step.tool && step.args && typeof step.args === 'object') {
    return { name: step.tool, input: step.args };
  }

  if (step.script?.command) {
    return { name: 'run_command', input: { command: step.script.command } };
  }

  return null;
}

function summarizeToolExecution(toolName: string, result: ToolExecutionResult): string {
  if (result.pendingApproval) {
    return `\n\n${toolName} is awaiting approval.\n`;
  }

  const body = result.success ? result.output : (result.error ?? result.output);
  const trimmed = body.trim();
  const capped = trimmed.length > 4000 ? trimmed.slice(-4000) : trimmed;
  return `\n\n${toolName} ${result.success ? 'succeeded' : 'failed'}${capped ? `:\n${capped}\n` : '.\n'}`;
}

function isVerificationTool(toolName: string): boolean {
  return ['run_command', 'diagnostics', 'execute_workspace_script'].includes(toolName);
}

function summarizeStepOutput(output: string, title: string): string {
  const trimmed = output.trim();
  if (!trimmed) return `Completed: ${title}`;
  const summaryMatch = trimmed.match(/(?:summary|result|completed)[:\s]+([\s\S]{80,4000})$/i);
  const summary = summaryMatch?.[1]?.trim() ?? trimmed.slice(-2500).trim();
  return summary.length > 3000 ? summary.slice(-3000).trim() : summary;
}

function normalizePlanPhase(phase: unknown): PlanPhase | undefined {
  if (phase === 'diagnostics' || phase === 'review' || phase === 'execute' || phase === 'verify') {
    return phase;
  }
  return undefined;
}

function inferPhaseFromTitle(title: string): PlanPhase {
  const text = title.toLowerCase();
  if (text.includes('phase 1') || text.includes('diagnostic')) return 'diagnostics';
  if (text.includes('phase 2') || text.includes('review')) return 'review';
  if (text.includes('phase 4') || text.includes('verify')) return 'verify';
  return inferStepPhase(title, 0);
}

// Re-export for backward compatibility
export { shouldDecomposeTask } from './TaskAnalyzer';
export { PLANNING_DISCOVERY_TOOLS } from '../plans/tools/planTools';
