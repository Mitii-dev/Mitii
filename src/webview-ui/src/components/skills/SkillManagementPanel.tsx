import { useEffect, useMemo, useState } from 'react';
import type {
  SkillAnalyzerResultView,
  SkillCatalogItem,
  SkillDocumentView,
  SkillDraftAnalysis,
  SkillTestRunResult,
  SkillUsageMetric,
  WebviewToExtensionMessage,
} from '../../../../vscode/webview/messages';
import type { SkillManifest, SkillMode } from '../../../../interfaces/skills/SkillManifest';

type SkillSection = 'catalog' | 'editor' | 'analyzer' | 'tests' | 'analytics';

interface Props {
  catalog: { items: SkillCatalogItem[]; total: number; error?: string };
  document?: SkillDocumentView;
  draftAnalysis?: SkillDraftAnalysis;
  analyzerResult?: SkillAnalyzerResultView;
  testResult?: SkillTestRunResult;
  analytics: SkillUsageMetric[];
  operationError?: string;
  postMessage: (message: WebviewToExtensionMessage) => void;
}

export function SkillManagementPanel(props: Props) {
  const [section, setSection] = useState<SkillSection>('catalog');
  const [query, setQuery] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | SkillMode>('all');
  const [sort, setSort] = useState<'name' | 'priority' | 'updated'>('name');
  const [offset, setOffset] = useState(0);
  const pageSize = 100;
  const [manifestText, setManifestText] = useState('');
  const [content, setContent] = useState('');
  const [revision, setRevision] = useState<string | undefined>();
  const [routingRequest, setRoutingRequest] = useState('Fix the failing authentication test');
  const [routingMode, setRoutingMode] = useState<SkillMode>('agent');
  const parsedManifest = useMemo(() => parseManifest(manifestText), [manifestText]);

  useEffect(() => {
    requestCatalog(props.postMessage, { query: '', limit: pageSize, offset: 0 });
  }, []);

  useEffect(() => {
    if (!props.document) return;
    setManifestText(JSON.stringify(props.document.manifest, null, 2));
    setContent(props.document.content);
    setRevision(props.document.revision);
    setSection('editor');
  }, [props.document?.revision]);

  const search = (nextOffset = 0) => {
    setOffset(nextOffset);
    requestCatalog(props.postMessage, {
      query,
      enabled: enabledFilter === 'all' ? undefined : enabledFilter === 'enabled',
      mode: modeFilter === 'all' ? undefined : modeFilter,
      sort,
      limit: pageSize,
      offset: nextOffset,
    });
  };
  const create = () => {
    const manifest = newManifest();
    setManifestText(JSON.stringify(manifest, null, 2));
    setContent(defaultSkillContent(manifest.name));
    setRevision(undefined);
    setSection('editor');
  };
  const analyzeDraft = () => {
    props.postMessage({
      type: 'analyzeSkillDraft',
      payload: { requestId: requestId(), manifest: parsedManifest.value, content },
    });
  };
  const save = () => {
    if (!parsedManifest.value) return;
    props.postMessage({
      type: 'saveSkill',
      payload: {
        requestId: requestId(),
        expectedRevision: revision,
        document: {
          manifest: parsedManifest.value as SkillManifest,
          content,
          source: 'repository',
        },
      },
    });
  };

  return (
    <main className="skill-management">
      <header className="skill-management__header">
        <div>
          <h2>Internal Skill Management</h2>
          <p>Development-only catalog, routing analysis, tests, and telemetry.</p>
        </div>
        <button className="primary-button" onClick={create}>Create skill</button>
      </header>

      <nav className="skill-management__tabs" aria-label="Skill management sections">
        {(['catalog', 'editor', 'analyzer', 'tests', 'analytics'] as SkillSection[]).map((item) => (
          <button
            key={item}
            className={section === item ? 'active' : ''}
            onClick={() => {
              setSection(item);
              if (item === 'analytics') props.postMessage({ type: 'requestSkillAnalytics', payload: { requestId: requestId() } });
            }}
          >
            {item}
          </button>
        ))}
      </nav>

      {props.operationError && <div className="skill-error">{props.operationError}</div>}

      {section === 'catalog' && (
        <section className="skill-catalog">
          <div className="skill-toolbar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && search()}
              placeholder="Search name, description, tag, or trigger"
            />
            <select value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value as typeof enabledFilter)}>
              <option value="all">All states</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value as typeof modeFilter)}>
              <option value="all">All modes</option>
              <option value="ask">Ask</option>
              <option value="plan">Plan</option>
              <option value="agent">Agent</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="name">Name</option>
              <option value="priority">Priority</option>
              <option value="updated">Updated</option>
            </select>
            <button onClick={() => search(0)}>Apply</button>
            <span>{props.catalog.total} skills</span>
          </div>
          <div className="skill-catalog__list">
            {props.catalog.items.map((skill) => (
              <button
                className="skill-row"
                key={skill.id}
                onClick={() => props.postMessage({ type: 'openSkill', payload: { requestId: requestId(), id: skill.id } })}
              >
                <span className="skill-row__title">{skill.name}</span>
                <span className={`skill-badge ${skill.enabled ? 'is-enabled' : ''}`}>{skill.enabled ? 'enabled' : 'disabled'}</span>
                <span className="skill-badge">{skill.status}</span>
                <span className="skill-row__description">{skill.description}</span>
                <span className="skill-row__meta">{skill.modes.join(', ')} · priority {skill.priority} · {skill.source}</span>
                {!skill.valid && <span className="skill-row__invalid">{skill.issues.length} schema issue(s)</span>}
              </button>
            ))}
            {props.catalog.items.length === 0 && <p className="empty-state">No matching skills.</p>}
          </div>
          <div className="skill-toolbar">
            <button disabled={offset === 0} onClick={() => search(Math.max(0, offset - pageSize))}>Previous</button>
            <span>{offset + 1}–{Math.min(offset + props.catalog.items.length, props.catalog.total)} of {props.catalog.total}</span>
            <button disabled={offset + pageSize >= props.catalog.total} onClick={() => search(offset + pageSize)}>Next</button>
          </div>
        </section>
      )}

      {section === 'editor' && (
        <section className="skill-editor">
          <div className="skill-editor__actions">
            <button onClick={analyzeDraft}>Validate</button>
            <button className="primary-button" disabled={!parsedManifest.value} onClick={save}>Save atomically</button>
            {revision && parsedManifest.value?.id && (
              <button
                className="danger-button"
                onClick={() => props.postMessage({
                  type: 'deleteSkill',
                  payload: { requestId: requestId(), id: parsedManifest.value!.id, expectedRevision: revision },
                })}
              >
                Delete
              </button>
            )}
          </div>
          {parsedManifest.error && <div className="skill-error">{parsedManifest.error}</div>}
          <div className="skill-editor__grid">
            <label>
              Manifest (`skill.json`)
              <textarea value={manifestText} onChange={(event) => setManifestText(event.target.value)} spellCheck={false} />
            </label>
            <label>
              Workflow (`SKILL.md`)
              <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} />
            </label>
          </div>
          {props.draftAnalysis && (
            <div className="skill-analysis-summary">
              <strong>{props.draftAnalysis.valid ? 'Valid manifest' : 'Validation failed'}</strong>
              <span>{props.draftAnalysis.estimatedFullChars} chars · ~{props.draftAnalysis.estimatedTokens} tokens</span>
              {props.draftAnalysis.issues.map((issue) => (
                <div key={`${issue.path}:${issue.code}`}>{issue.path || 'manifest'}: {issue.message}</div>
              ))}
              <details>
                <summary>Quick-reference preview</summary>
                <pre>{props.draftAnalysis.quickReference}</pre>
              </details>
            </div>
          )}
        </section>
      )}

      {section === 'analyzer' && (
        <section className="skill-analyzer">
          <div className="skill-toolbar">
            <select value={routingMode} onChange={(event) => setRoutingMode(event.target.value as SkillMode)}>
              <option value="ask">Ask</option>
              <option value="plan">Plan</option>
              <option value="agent">Agent</option>
            </select>
            <textarea value={routingRequest} onChange={(event) => setRoutingRequest(event.target.value)} />
            <button className="primary-button" onClick={() => props.postMessage({
              type: 'analyzeSkillRouting',
              payload: { requestId: requestId(), input: { request: routingRequest, mode: routingMode } },
            })}>
              Analyze routing
            </button>
          </div>
          {props.analyzerResult && <AnalyzerResult result={props.analyzerResult} />}
        </section>
      )}

      {section === 'tests' && (
        <section className="skill-tests">
          <p>Run positive, negative, compatibility, tool, technology, and budget cases declared in the selected manifest.</p>
          <button
            className="primary-button"
            disabled={!parsedManifest.value?.id}
            onClick={() => parsedManifest.value && props.postMessage({
              type: 'runSkillTests',
              payload: { requestId: requestId(), skillId: parsedManifest.value.id },
            })}
          >
            Run selected skill tests
          </button>
          {props.testResult && (
            <div>
              <h3>{props.testResult.passed} passed · {props.testResult.failed} failed</h3>
              {props.testResult.results.map((result) => (
                <details key={result.id} className={result.passed ? 'skill-test-pass' : 'skill-test-fail'}>
                  <summary>{result.passed ? 'PASS' : 'FAIL'} · {result.name}</summary>
                  <p>Expected {result.expected}; got {result.actual}</p>
                  <ul>{result.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'analytics' && (
        <section className="skill-analytics">
          <p>Sanitized counters only. Repository contents and prompts are not stored.</p>
          {props.analytics.map((metric) => (
            <div className="skill-metric" key={metric.skillId}>
              <strong>{metric.skillId}</strong>
              <span>suggested {metric.suggested}</span>
              <span>selected {metric.selected}</span>
              <span>loaded {metric.loaded}</span>
              <span>rejected {metric.rejected}</span>
              <span>success/failure {metric.successes}/{metric.failures}</span>
              <span>avg score {metric.averageScore.toFixed(1)}</span>
              <span>avg injection {metric.averageInjectionChars.toFixed(0)} chars</span>
            </div>
          ))}
          {props.analytics.length === 0 && <p className="empty-state">No skill usage has been recorded in this runtime.</p>}
        </section>
      )}
    </main>
  );
}

function AnalyzerResult({ result }: { result: SkillAnalyzerResultView }) {
  return (
    <div className="skill-analyzer__result">
      <h3>Selection</h3>
      <p>Primary: {result.resolution.primarySkillId ?? 'none'} · Supporting: {result.resolution.supportingSkillId ?? 'none'}</p>
      <p>Repository: {result.repositoryProfile.languages.join(', ') || 'unknown'} · {result.repositoryProfile.frameworks.join(', ') || 'no detected framework'}</p>
      <p>Injection: {result.injectionChars} chars · ~{result.injectionTokens} tokens</p>
      <h3>Candidates</h3>
      {[...result.resolution.candidateSkills, ...result.resolution.rejectedSkills].map((candidate) => (
        <details key={candidate.id}>
          <summary>{candidate.name} · {candidate.status} · score {candidate.score}</summary>
          {candidate.factors.map((factor) => <div key={factor.key}>{factor.key}: {factor.score} — {factor.reason}</div>)}
          {candidate.rejectionReasons.map((reason) => <div key={reason}>Rejected: {reason}</div>)}
          {candidate.pinningEffects.map((effect) => <div key={effect}>Pin: {effect}</div>)}
        </details>
      ))}
      <details>
        <summary>Final injected context</summary>
        <pre>{result.finalContext || '(no skill context)'}</pre>
      </details>
    </div>
  );
}

function requestCatalog(
  postMessage: Props['postMessage'],
  payload: {
    query?: string;
    enabled?: boolean;
    mode?: string;
    sort?: 'name' | 'priority' | 'updated';
    limit?: number;
    offset?: number;
  }
): void {
  postMessage({ type: 'requestSkillCatalog', payload: { requestId: requestId(), ...payload } });
}

function requestId(): string {
  return `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseManifest(text: string): { value?: SkillManifest; error?: string } {
  try {
    return { value: JSON.parse(text) as SkillManifest };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function newManifest(): SkillManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: 'new-skill',
    name: 'New skill',
    description: 'Describe what this workflow does and when it should be selected.',
    version: '1.0.0',
    apiVersion: '1',
    owner: 'internal',
    edition: 'ce',
    enabled: true,
    status: 'experimental',
    kind: 'workflow',
    supportedModes: ['ask', 'plan', 'agent'],
    intents: [],
    taskKinds: [],
    taskSubtypes: [],
    triggers: [],
    negativeTriggers: [],
    requiredTools: [],
    requiredCapabilities: [],
    dependencies: [],
    conflicts: [],
    entrypoint: 'SKILL.md',
    referenceFiles: [],
    maxInjectionChars: 8_000,
    injectionStrategy: 'lazy-references',
    trust: 'managed',
    priority: 0,
    pinningRules: [],
    tests: [],
    createdAt: now,
    updatedAt: now,
  };
}

function defaultSkillContent(name: string): string {
  return `# ${name}

## Quick Reference

- Add the minimal workflow guidance.

## Ask Guidance

- Ground answers in repository evidence.

## Planning Guidance

- Discover affected boundaries before compiling the plan.

## Agent Execution Guidance

- Make scoped changes and preserve existing behavior.

## Verification Guidance

- Run targeted verification.

## Failure Behavior

- Stop and report evidence when a required precondition is missing.
`;
}
