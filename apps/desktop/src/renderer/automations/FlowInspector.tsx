/**
 * Node inspector for trigger, command, and agent.
 */

import type {
  AutomationFlowDocument,
  FlowDeliveryConfig,
} from '../../shared/automations/flow.js';
import {
  FLOW_DELIVERY_ADAPTERS,
  FLOW_EVENT_TYPES,
  materializeConnections,
  syncFlowAttachments,
  type FlowVariable,
} from '../../shared/automations/flow.js';
import type { CanvasSelection } from './FlowCanvas.js';

interface FlowInspectorProps {
  flow: AutomationFlowDocument;
  selection: CanvasSelection;
  workspaceRoot?: string;
  catalog?: AutomationCatalog;
  onChange: (flow: AutomationFlowDocument) => void;
}

export interface AutomationCatalog {
  profiles: Array<{ id: string; name: string; model?: string }>;
  models?: string[];
  repositories?: Array<{ path: string; label: string }>;
  mcpServers: Array<{ id: string; name: string }>;
  skills: Array<{ id: string; title: string }>;
  recipes: Array<{ id: string; title: string }>;
}

export function FlowInspector(props: FlowInspectorProps) {
  const { flow, selection, onChange, catalog, workspaceRoot } = props;

  if (!selection) {
    return (
      <div className="flow-inspector">
        <h3 className="flow-inspector__title">Inspector</h3>
        <p className="flow-inspector__hint">
          Select a node to edit it. Drag from a port to reattach a wire.
          Delete removes the selected wire.
        </p>
        <VariablesEditor
          variables={flow.variables ?? []}
          onChange={(variables) => onChange({ ...flow, variables })}
        />
        <label className="flow-inspector__label">
          Flow title
          <input
            className="flow-inspector__input"
            value={flow.title}
            onChange={(e) => onChange({ ...flow, title: e.target.value })}
          />
        </label>
        <label className="flow-inspector__label">
          Spec id (filename)
          <input
            className="flow-inspector__input"
            value={flow.id}
            onChange={(e) =>
              onChange({
                ...flow,
                id: e.target.value.replace(/[^a-zA-Z0-9._-]/g, '-'),
              })
            }
          />
        </label>
        <label className="flow-inspector__check">
          <input
            type="checkbox"
            checked={flow.enabled}
            onChange={(e) =>
              onChange({ ...flow, enabled: e.target.checked })
            }
          />
          Enabled
        </label>
      </div>
    );
  }

  if (selection.kind === 'trigger') {
    return (
      <div className="flow-inspector">
        <h3 className="flow-inspector__title">Trigger</h3>
        <label className="flow-inspector__label">
          Kind
          <select
            className="flow-inspector__input"
            value={flow.trigger.kind}
            onChange={(e) => {
              const kind = e.target.value;
              if (kind === 'schedule') {
                onChange({
                  ...flow,
                  trigger: {
                    kind: 'schedule',
                    cron: '0 9 * * MON-FRI',
                    timezone:
                      Intl.DateTimeFormat().resolvedOptions().timeZone ||
                      'UTC',
                  },
                });
              } else if (kind === 'event') {
                onChange({
                  ...flow,
                  trigger: {
                    kind: 'event',
                    eventType: 'github.push',
                    dedupeWindowSeconds: 600,
                    cooldownSeconds: 120,
                  },
                });
              } else if (kind === 'manual') {
                onChange({ ...flow, trigger: { kind: 'manual' } });
              } else {
                onChange({ ...flow, trigger: { kind: 'one_off' } });
              }
            }}
          >
            <option value="manual">Manual</option>
            <option value="event">On commit</option>
            {flow.trigger.kind === 'schedule' ? (
              <option value="schedule">Schedule</option>
            ) : null}
          </select>
        </label>

        {flow.trigger.kind === 'schedule' ? (
          <p className="flow-inspector__hint">
            Scheduled triggers are not active yet. Switch this flow to Manual.
          </p>
        ) : null}

        {flow.trigger.kind === 'event' ? (
          <>
            <label className="flow-inspector__label">
              Event type
              <input
                className="flow-inspector__input"
                list="mitii-event-types"
                value={flow.trigger.eventType}
                onChange={(e) => {
                  if (flow.trigger.kind !== 'event') return;
                  onChange({
                    ...flow,
                    trigger: {
                      ...flow.trigger,
                      kind: 'event',
                      eventType: e.target.value,
                    },
                  });
                }}
              />
              <datalist id="mitii-event-types">
                {FLOW_EVENT_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="flow-inspector__label">
              Filters JSON
              <textarea
                className="flow-inspector__textarea"
                rows={4}
                value={JSON.stringify(flow.trigger.filters ?? {}, null, 2)}
                onChange={(e) => {
                  if (flow.trigger.kind !== 'event') return;
                  try {
                    const filters = JSON.parse(e.target.value) as Record<
                      string,
                      unknown
                    >;
                    onChange({
                      ...flow,
                      trigger: { ...flow.trigger, kind: 'event', filters },
                    });
                  } catch {
                    /* keep typing */
                  }
                }}
              />
            </label>
            <div className="flow-inspector__row">
              <label className="flow-inspector__label">
                Dedupe (s)
                <input
                  className="flow-inspector__input"
                  type="number"
                  value={flow.trigger.dedupeWindowSeconds ?? ''}
                  onChange={(e) => {
                    if (flow.trigger.kind !== 'event') return;
                    onChange({
                      ...flow,
                      trigger: {
                        ...flow.trigger,
                        kind: 'event',
                        dedupeWindowSeconds: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      },
                    });
                  }}
                />
              </label>
              <label className="flow-inspector__label">
                Cooldown (s)
                <input
                  className="flow-inspector__input"
                  type="number"
                  value={flow.trigger.cooldownSeconds ?? ''}
                  onChange={(e) => {
                    if (flow.trigger.kind !== 'event') return;
                    onChange({
                      ...flow,
                      trigger: {
                        ...flow.trigger,
                        kind: 'event',
                        cooldownSeconds: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      },
                    });
                  }}
                />
              </label>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  if (selection.kind === 'agent') {
    return (
      <AgentInspector
        flow={flow}
        catalog={catalog}
        workspaceRoot={workspaceRoot}
        onChange={onChange}
      />
    );
  }

  if (selection.kind === 'step') {
    const step = flow.steps.find((s) => s.id === selection.id);
    if (!step) {
      return (
        <div className="flow-inspector">
          <p className="flow-inspector__hint">Step not found.</p>
        </div>
      );
    }
    const updateStep = (
      patch: Partial<import('../../shared/automations/flow.js').FlowStepConfig>,
    ) => {
      onChange({
        ...flow,
        steps: flow.steps.map((s) =>
          s.id === step.id ? ({ ...s, ...patch } as typeof s) : s,
        ),
      });
    };
    return (
      <div className="flow-inspector">
        <h3 className="flow-inspector__title">Step · {step.kind}</h3>
        <p className="flow-inspector__hint">
          Deterministic host step — runs before the agent (enterprise pre-pipeline).
        </p>
        <label className="flow-inspector__label">
          Label
          <input
            className="flow-inspector__input"
            value={step.label ?? ''}
            onChange={(e) => updateStep({ label: e.target.value || undefined })}
          />
        </label>
        {step.kind === 'review' ? (
          <label className="flow-inspector__label">
            Focus paths (comma-separated)
            <input
              className="flow-inspector__input"
              value={(step.paths ?? []).join(', ')}
              onChange={(e) =>
                updateStep({
                  paths: e.target.value
                    .split(',')
                    .map((p) => p.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        ) : null}
        {step.kind === 'command' ? (
          <>
            <label className="flow-inspector__label">
              Argv (space-separated, no shell)
              <input
                className="flow-inspector__input"
                value={step.argv.join(' ')}
                onChange={(e) =>
                  updateStep({
                    argv: e.target.value.trim().split(/\s+/).filter(Boolean),
                  })
                }
              />
            </label>
            <div className="flow-inspector__row">
              <label className="flow-inspector__label">
                Timeout (s)
                <input
                  className="flow-inspector__input"
                  type="number"
                  value={step.timeoutSeconds ?? 600}
                  onChange={(e) =>
                    updateStep({
                      timeoutSeconds: Number(e.target.value) || 600,
                    })
                  }
                />
              </label>
              <label className="flow-inspector__check">
                <input
                  type="checkbox"
                  checked={step.failOnError !== false}
                  onChange={(e) =>
                    updateStep({ failOnError: e.target.checked })
                  }
                />
                Stop the flow if the command fails
              </label>
              <label className="flow-inspector__check">
                <input
                  type="checkbox"
                  checked={step.passOutput !== false}
                  onChange={(e) =>
                    updateStep({ passOutput: e.target.checked })
                  }
                />
                Pass output to the next module
              </label>
            </div>
          </>
        ) : null}
        {step.kind === 'index' ? (
          <p className="flow-inspector__hint">
            Reindexes the workspace via @mitii/host before the agent runs.
          </p>
        ) : null}
        {step.kind === 'recipe' || step.kind === 'mcp' || step.kind === 'skill' ? (
          <p className="flow-inspector__hint">
            Attached from Desktop
            {step.kind === 'recipe'
              ? ` · ${step.recipeId || 'recipe'}`
              : step.kind === 'mcp'
                ? ` · ${step.serverId || 'mcp'}`
                : ` · ${step.skillId || 'skill'}`}
            . Remove the node to detach it.
          </p>
        ) : null}
        {step.kind === 'hook' ? (
          <>
            <label className="flow-inspector__label">
              Hook kind
              <select
                className="flow-inspector__input"
                value={step.hookKind}
                onChange={(e) =>
                  updateStep({
                    hookKind: e.target.value as
                      | 'post-commit'
                      | 'pre-push'
                      | 'custom',
                  })
                }
              >
                <option value="post-commit">post-commit</option>
                <option value="pre-push">pre-push</option>
                <option value="custom">custom</option>
              </select>
            </label>
            <label className="flow-inspector__label">
              Hook id (optional)
              <input
                className="flow-inspector__input"
                value={step.hookId ?? ''}
                onChange={(e) =>
                  updateStep({ hookId: e.target.value || undefined })
                }
              />
            </label>
          </>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            onChange(
              syncFlowAttachments({
                ...flow,
                steps: flow.steps.filter((s) => s.id !== step.id),
                connections: materializeConnections(flow).filter(
                  (edge) =>
                    !(edge.from.kind === 'step' && edge.from.id === step.id) &&
                    !(edge.to.kind === 'step' && edge.to.id === step.id),
                ),
              }),
            )
          }
        >
          Remove step
        </button>
      </div>
    );
  }

  const delivery = flow.delivery.find((d) => d.id === selection.id);
  if (!delivery) {
    return (
      <div className="flow-inspector">
        <p className="flow-inspector__hint">Delivery node not found.</p>
      </div>
    );
  }

  const updateDelivery = (patch: Partial<FlowDeliveryConfig>) => {
    onChange({
      ...flow,
      delivery: flow.delivery.map((d) =>
        d.id === delivery.id ? { ...d, ...patch } : d,
      ),
    });
  };

  return (
    <div className="flow-inspector">
      <h3 className="flow-inspector__title">Delivery</h3>
      <label className="flow-inspector__label">
        Adapter
        <select
          className="flow-inspector__input"
          value={delivery.adapter}
          onChange={(e) =>
            updateDelivery({
              adapter: e.target.value as FlowDeliveryConfig['adapter'],
            })
          }
        >
          {FLOW_DELIVERY_ADAPTERS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="flow-inspector__label">
        Target
        <input
          className="flow-inspector__input"
          value={delivery.target}
          placeholder="webhook URL / channel / repo#pr"
          onChange={(e) => updateDelivery({ target: e.target.value })}
        />
      </label>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() =>
          onChange({
            ...flow,
            delivery: flow.delivery.filter((d) => d.id !== delivery.id),
          })
        }
      >
        Remove delivery
      </button>
    </div>
  );
}

function AgentInspector(props: {
  flow: AutomationFlowDocument;
  catalog?: AutomationCatalog;
  workspaceRoot?: string;
  onChange: (flow: AutomationFlowDocument) => void;
}) {
  const { flow, onChange, catalog, workspaceRoot } = props;
  const agent = flow.agent;

  const patchAgent = (patch: Partial<typeof agent>) => {
    onChange({ ...flow, agent: { ...agent, ...patch } });
  };

  return (
    <div className="flow-inspector">
      <h3 className="flow-inspector__title">Agent</h3>
      <p className="flow-inspector__hint">
        Same kind of run as chat. Attach MCP, skills, and recipes that already
        exist in Desktop.
      </p>
      <label className="flow-inspector__label">
        Mode
        <select
          className="flow-inspector__input"
          value={agent.mode}
          onChange={(e) =>
            patchAgent({ mode: e.target.value as typeof agent.mode })
          }
        >
          <option value="ask">ask</option>
          <option value="plan">plan</option>
          <option value="agent">agent</option>
        </select>
      </label>
      <label className="flow-inspector__label">
        Message
        <textarea
          className="flow-inspector__textarea"
          rows={6}
          value={agent.prompt}
          onChange={(e) => patchAgent({ prompt: e.target.value })}
        />
      </label>
      <label className="flow-inspector__label">
        Profile
        <select
          className="flow-inspector__input"
          value={agent.profileId ?? ''}
          onChange={(e) =>
            patchAgent({ profileId: e.target.value || undefined })
          }
        >
          <option value="">Active profile</option>
          {(catalog?.profiles ?? []).map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flow-inspector__label">
        Repository
        <select
          className="flow-inspector__input"
          value={agent.repository || workspaceRoot || ''}
          onChange={(e) =>
            patchAgent({ repository: e.target.value.trim() || undefined })
          }
        >
          {(catalog?.repositories?.length
            ? catalog.repositories
            : workspaceRoot
              ? [{ path: workspaceRoot, label: workspaceLabel(workspaceRoot) }]
              : []
          ).map((repo) => (
            <option key={repo.path} value={repo.path}>
              {repo.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flow-inspector__label">
        Model
        <select
          className="flow-inspector__input"
          value={agent.model ?? ''}
          onChange={(e) =>
            patchAgent({ model: e.target.value.trim() || undefined })
          }
        >
          <option value="">Profile default</option>
          {modelOptions(catalog, agent.profileId, agent.model).map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <label className="flow-inspector__label">
        Context files / folders
        <textarea
          className="flow-inspector__textarea"
          rows={3}
          placeholder="src/auth&#10;tests/"
          value={(agent.contextPaths ?? []).join('\n')}
          onChange={(e) =>
            patchAgent({
              contextPaths: e.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <p className="flow-inspector__hint">
        Use {'{{name}}'} in the message to insert a variable. Drag MCP, skills,
        and recipes onto the canvas to attach them.
      </p>
    </div>
  );
}

function VariablesEditor(props: {
  variables: FlowVariable[];
  onChange: (variables: FlowVariable[]) => void;
}) {
  return (
    <div className="flow-vars">
      <div className="flow-inspector__mapping-head">Variables</div>
      {props.variables.length === 0 ? (
        <p className="flow-inspector__hint">No variables yet.</p>
      ) : (
        props.variables.map((variable) => (
          <div key={variable.id} className="flow-vars__row">
            <input
              className="flow-inspector__input"
              placeholder="name"
              value={variable.key}
              onChange={(e) =>
                props.onChange(
                  props.variables.map((item) =>
                    item.id === variable.id
                      ? { ...item, key: e.target.value }
                      : item,
                  ),
                )
              }
            />
            <input
              className="flow-inspector__input"
              placeholder="value"
              value={variable.value}
              onChange={(e) =>
                props.onChange(
                  props.variables.map((item) =>
                    item.id === variable.id
                      ? { ...item, value: e.target.value }
                      : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                props.onChange(
                  props.variables.filter((item) => item.id !== variable.id),
                )
              }
            >
              Remove
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() =>
          props.onChange([
            ...props.variables,
            {
              id: `var_${Date.now().toString(36)}`,
              key: '',
              value: '',
            },
          ])
        }
      >
        Add variable
      </button>
    </div>
  );
}

function workspaceLabel(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return name || path;
}

function modelOptions(
  catalog: AutomationCatalog | undefined,
  profileId: string | undefined,
  current: string | undefined,
): string[] {
  const fromCatalog = catalog?.models ?? [];
  const profileModel = catalog?.profiles.find((p) => p.id === profileId)?.model;
  return [...new Set([current, profileModel, ...fromCatalog].filter(Boolean) as string[])];
}
