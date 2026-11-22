import { describe, it, expect, vi } from 'vitest';
import { decideVerificationGate } from './actions/decideVerificationGate';
import { maybeAutoAdvanceTaskList, completePlanStepsFromDiagnostics } from './internal/taskListRuntime';
import { evaluateActiveStepMutateReadiness, mutateLockModelRequestFields } from './modules/mutate-readiness';
import { decideMutateEvidenceAction } from './modules/mutate-readiness/decideMutateEvidenceAction';
import { createLoopFileReadTracker, markLoopFileReadResult } from './actions/isExplorationRereadHeavy';
import { applySucceededMutationSideEffects } from './actions/invalidateReadonlyCachesAfterMutation';
import { ToolCallCache } from './internal/ToolCallCache';
import { V8EnginePipeline } from './pipeline/V8EnginePipeline';
import { createStubDependencies, createDecision, createReadOnlyGrant, ScriptedLlmPort } from './tests/fixtures/stubs';
import { finishVerificationAccepted } from './pipeline/finishVerificationAccepted';
import { ToolLoopGuard } from './modules/tool-loop-guard';
import { refineExecutionSeedFromContext } from './modules/execution-seed/refineFromContext';
import { ReadLedger } from './internal/ReadLedger';

describe('Audit: reproduce current failure behavior (not desired invariants)', () => {
  it('six different successful-intent patches to one file trigger force-final by call signature', () => {
    const guard = new ToolLoopGuard({hardIdenticalLimit: 6});
    const outcomes = Array.from({length: 6}, (_, i) => guard.observeCalls([{name: 'apply_patch', arguments: {patches: [{path: 'src/a.ts', oldText: `old${i}`, newText: `new${i}`} ]}}]));
    expect(outcomes[5].type).toBe('force_final');
  });
  it('auth seed enrichment trusts candidate entry points without existence evidence', () => {
    const seed = refineExecutionSeedFromContext({seed: {paths: ['packages/api/src/routes/login.ts'], symbols: [], causeNotes: [], source: 'user', confidence: 'trusted'}, contextPaths: [], userPrompt: 'Fix login'});
    expect(seed.confidence).toBe('trusted');
    expect(seed.paths).toContain('packages/api/src/index.js');
    expect(seed.paths).toContain('packages/api/src/src/index.js');
  });
  it('read ledger suppresses larger byte-limit retry with unchanged path and range', () => {
    const ledger = new ReadLedger();
    ledger.record({toolName: 'read_file', argumentsValue: {path: 'src/a.ts', maxBytes: 100}});
    expect(ledger.lookup({toolName: 'read_file', argumentsValue: {path: 'src/a.ts', maxBytes: 10000}})).toBeDefined();
  });
  it('failed required behavioral test with zero diagnostic delta is accepted', () => {
    const result = decideVerificationGate({ verificationRequired: true, allowUnavailable: false,
      changedFileCount: 1, canVerify: true, changedFiles: ['src/auth.ts'], minimumEvidence: ['tests'],
      verification: { schemaVersion: 1, status: 'verification_failed', stateToken: 't', affectedProjectIds: [],
        checks: [{checkId: 'auth:test', projectId: 'auth', kind: 'test', label: 'auth tests', evidenceSource: 'manifest', outcome: 'failed', summary: 'AssertionError: expected 401, received 200'}],
        diagnostics: [], diff: {reviewed: true, staleStateRisk: false, summary: '', changedPaths: ['src/auth.ts']}, warnings: [], reasonCodes: ['checks_failed'], durationMs: 1 },
      comparison: {beforeErrorCount: 0, afterErrorCount: 0, clearedErrorCount: 0, newErrorCount: 0, remainingErrorCount: 0, failedCheckIdsBefore: [], failedCheckIdsAfter: ['auth:test'], reasonCodes: ['checks_still_failing']}
    });
    expect(result).toEqual({action: 'accept', acceptKind: 'implemented_unverified'});
  });
  it('one touched file completes multiple independent requirements in that file', () => {
    const result = maybeAutoAdvanceTaskList({enabled: true, current: {schemaVersion: 1, source: 'plan', purpose: 'execution', items: [
      {id: 'a', title: 'Add login in src/auth.ts', status: 'active', write: ['src/auth.ts']},
      {id: 'b', title: 'Add logout in src/auth.ts', status: 'pending', write: ['src/auth.ts']}
    ]}, toolStatus: 'succeeded', isMutatingTool: true, changedFiles: ['src/auth.ts']});
    expect(result.taskList?.items.every(x => x.status === 'done')).toBe(true);
  });
  it('undefined diagnostics complete a diagnostic repair task', () => {
    const result = completePlanStepsFromDiagnostics({current: {schemaVersion: 1, source: 'plan', items: [
      {id: 'a', title: 'Fix TS2322 in src/a.ts', status: 'active', write: ['src/a.ts']}
    ]}, taskListRef: {}, diagnostics: undefined});
    expect(result.taskList?.items[0].status).toBe('done');
  });
  it('a fact merely mentioning a path is considered loaded source evidence', () => {
    expect(evaluateActiveStepMutateReadiness({mutationRequired: true, seedTrusted: true, seedPaths: ['src/a.ts'], maxEvidencePaths: 4,
      establishedFacts: [{id: 'search', content: 'src/a.ts exists but has not been read'}]}).ready).toBe(true);
  });
  it('an EOF tail window is considered a fully loaded file', () => {
    const tracker = createLoopFileReadTracker();
    markLoopFileReadResult(tracker, 'src/a.ts:900-1000', {eof: true, truncated: false});
    expect(evaluateActiveStepMutateReadiness({mutationRequired: true, seedTrusted: true, seedPaths: ['src/a.ts'], maxEvidencePaths: 4, loopFileReads: tracker}).ready).toBe(true);
  });
  it('active row with no paths becomes patch-ready despite readiness=false', () => {
    expect(decideMutateEvidenceAction({readiness: {ready: false, activeItemId: 'a', writePaths: [], missingPaths: []}, seedTrusted: true,
      evidenceGateNudges: 0, maxEvidenceGateNudges: 1, recoveryAlreadyUsed: false, maxRecoveryPaths: 1}).kind).toBe('PATCH_READY');
  });
  it('mutation lock can require only a nonmutating support tool', () => {
    const result = mutateLockModelRequestFields([{name: 'analyze_change_impact', description: '', inputSchema: {type: 'object'}}] as any, {allowTargetedReads: false});
    expect(result.toolChoice).toBe('required');
    expect(result.tools?.map(t => t.name)).toEqual(['analyze_change_impact']);
  });
  it('successful shell mutation does not record its reported changed file', () => {
    const changedFiles: string[] = [];
    applySucceededMutationSideEffects({toolName: 'run_command', output: {changedFiles: ['src/a.ts']}, changedFiles, mutationCheckpointIds: [], toolCache: new ToolCallCache(), reasonCodes: []});
    expect(changedFiles).toEqual([]);
  });
  it('same call ID and same tool with different arguments executes only once', async () => {
    const dependencies = createStubDependencies({decision: createDecision({route: 'repository_answer', toolGrant: createReadOnlyGrant()}),
      llm: new ScriptedLlmPort([
        {content: '', toolCalls: [{id: 'call_0', name: 'read_file', arguments: '{"path":"src/a.ts"}'}]},
        {content: '', toolCalls: [{id: 'call_0', name: 'read_file', arguments: '{"path":"src/b.ts"}'}]},
        {content: 'Both files reviewed.'}
      ])});
    const spy = vi.spyOn(dependencies.tools!, 'execute');
    await new V8EnginePipeline(dependencies).start({schemaVersion: 1, workspaceRoot: '/repo', request: {sessionId: 'audit', mode: 'ask', userMessage: 'Review src/a.ts and src/b.ts', workspace: {workspaceId: 'ws'}}}).result;
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('accepted verification completes with open requested work and a confident answer', async () => {
    const finish = vi.fn(x => x);
    const result = await finishVerificationAccepted({runtime: {safeUnpin: async () => {}} as any, runId: 'audit', pinnedState: undefined, reasonCodes: [], repairAttempts: 0,
      loopAnswer: 'Done.', loopChangedFiles: ['src/a.ts'], record: undefined, remainingErrorCount: 0, newErrorCount: 0,
      decision: createDecision({route: 'execute', toolGrant: createReadOnlyGrant({maximumWorkspaceEffect: 'write', allowedTools: ['apply_patch']})}), understanding: undefined,
      taskList: {schemaVersion: 1, source: 'plan', purpose: 'execution', items: [{id: 'b', title: 'Implement required endpoint in src/b.ts', status: 'pending', write: ['src/b.ts']}]}, finish: finish as any});
    expect(result.status).toBe('completed');
    expect(result.answer).toBe('Done.');
  });
});
