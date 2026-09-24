/**
 * Flow canvas — Trigger → Command → Agent.
 */

import { useCallback, useMemo, useState } from 'react';

import {
  applyModuleToFlow,
  MODULE_DRAG_MIME,
} from '../../shared/automations/applyModule.js';
import {
  connectNodes,
  createFlowStep,
  defaultStepPosition,
  disconnectNodes,
  insertStepBeforeAgent,
  materializeConnections,
  type AutomationFlowDocument,
  type FlowEndpoint,
  type FlowNodeKind,
  type FlowStepKind,
} from '../../shared/automations/flow.js';
import { parseDraggedModule } from '../../shared/automations/modules.js';

export type CanvasSelection =
  | { kind: 'trigger' }
  | { kind: 'agent' }
  | { kind: 'step'; id: string }
  | { kind: 'delivery'; id: string }
  | null;

export type NodeRunState = 'queued' | 'running' | 'done' | 'failed';

interface FlowCanvasProps {
  flow: AutomationFlowDocument;
  selection: CanvasSelection;
  nodeState?: Record<string, NodeRunState>;
  onSelect: (sel: CanvasSelection) => void;
  onChange: (flow: AutomationFlowDocument) => void;
  /** Called when a locked module is dropped — parent opens activate modal. */
  onModuleDropNeedsActivation?: (moduleId: string) => void;
  /** Connection ids that are activated (for drop gating). */
  activatedConnections?: Set<string> | string[];
}

const NODE_W = 200;
const NODE_H = 88;

function triggerSubtitle(flow: AutomationFlowDocument): string {
  const t = flow.trigger;
  if (t.kind === 'schedule') return t.cron;
  if (t.kind === 'event') return t.eventType;
  return t.kind;
}

function stepSubtitle(step: AutomationFlowDocument['steps'][number]): string {
  if (step.kind === 'command') return step.argv.join(' ').slice(0, 42);
  if (step.kind === 'review') return step.paths?.join(', ') || 'working tree';
  if (step.kind === 'recipe') return step.recipeId || 'pick recipe';
  if (step.kind === 'mcp') {
    return step.toolName
      ? `${step.serverId}/${step.toolName}`
      : step.serverId || 'configure MCP';
  }
  if (step.kind === 'hook') return step.hookKind;
  if (step.kind === 'skill') {
    return step.skillId || 'skill';
  }
  return 'workspace index';
}

export function FlowCanvas(props: FlowCanvasProps) {
  const {
    flow,
    selection,
    nodeState,
    onSelect,
    onChange,
  } = props;
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [wire, setWire] = useState<{
    from: FlowEndpoint;
    x: number;
    y: number;
  } | null>(null);
  const [drag, setDrag] = useState<{
    kind: FlowNodeKind;
    id?: string;
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } | null>(null);
  const [dropHover, setDropHover] = useState(false);

  const nodeCenter = (pos: { x: number; y: number }, side: 'in' | 'out') => ({
    x: side === 'out' ? pos.x + NODE_W : pos.x,
    y: pos.y + NODE_H / 2,
  });

  const positionOf = useCallback(
    (endpoint: FlowEndpoint): { x: number; y: number } => {
      if (endpoint.kind === 'trigger') return flow.layout.trigger;
      if (endpoint.kind === 'agent') return flow.layout.agent;
      if (endpoint.kind === 'step') {
        return flow.layout.steps[endpoint.id] ?? defaultStepPosition(0);
      }
      return flow.layout.delivery[endpoint.id] ?? { x: 680, y: 120 };
    },
    [flow.layout],
  );

  const edges = useMemo(() => {
    return materializeConnections(flow).map((edge) => {
      const a = nodeCenter(positionOf(edge.from), 'out');
      const b = nodeCenter(positionOf(edge.to), 'in');
      return {
        id: edge.id,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      };
    });
  }, [flow, positionOf]);

  const resolvePos = (
    kind: FlowNodeKind,
    id?: string,
  ): { x: number; y: number } => {
    if (kind === 'trigger') return flow.layout.trigger;
    if (kind === 'agent') return flow.layout.agent;
    if (kind === 'step' && id) {
      return flow.layout.steps[id] ?? defaultStepPosition(0);
    }
    if (kind === 'delivery' && id) {
      return flow.layout.delivery[id] ?? { x: 680, y: 120 };
    }
    return { x: 0, y: 0 };
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent, kind: FlowNodeKind, id?: string) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const pos = resolvePos(kind, id);
      setDrag({
        kind,
        id,
        ox: pos.x,
        oy: pos.y,
        sx: e.clientX,
        sy: e.clientY,
      });
      if (kind === 'delivery' && id) onSelect({ kind: 'delivery', id });
      else if (kind === 'step' && id) onSelect({ kind: 'step', id });
      else if (kind === 'trigger' || kind === 'agent') onSelect({ kind });
    },
    [flow.layout, onSelect],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const x = Math.max(8, drag.ox + (e.clientX - drag.sx));
      const y = Math.max(8, drag.oy + (e.clientY - drag.sy));
      const next = {
        ...flow,
        layout: {
          ...flow.layout,
          steps: { ...flow.layout.steps },
          delivery: { ...flow.layout.delivery },
        },
      };
      if (drag.kind === 'trigger') next.layout.trigger = { x, y };
      else if (drag.kind === 'agent') next.layout.agent = { x, y };
      else if (drag.kind === 'step' && drag.id) {
        next.layout.steps[drag.id] = { x, y };
      } else if (drag.kind === 'delivery' && drag.id) {
        next.layout.delivery[drag.id] = { x, y };
      }
      onChange(next);
    },
    [drag, flow, onChange],
  );

  const addStep = (kind: FlowStepKind) => {
    const step = createFlowStep(kind);
    const index = flow.steps.length;
    const next = {
      ...flow,
      steps: [...flow.steps, step],
      layout: {
        ...flow.layout,
        steps: {
          ...flow.layout.steps,
          [step.id]: defaultStepPosition(index),
        },
      },
    };
    onChange(
      kind === 'command' || kind === 'index' || kind === 'review' || kind === 'hook'
        ? insertStepBeforeAgent(next, step.id)
        : connectNodes(next, { kind: 'step', id: step.id }, { kind: 'agent' }),
    );
    onSelect({ kind: 'step', id: step.id });
  };

  const beginWire = (e: React.PointerEvent, from: FlowEndpoint) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement)
      .closest('.flow-canvas')
      ?.getBoundingClientRect();
    setWire({
      from,
      x: rect ? e.clientX - rect.left : e.clientX,
      y: rect ? e.clientY - rect.top : e.clientY,
    });
    setSelectedEdge(null);
  };

  const handleModuleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHover(false);
    const moduleId =
      e.dataTransfer.getData(MODULE_DRAG_MIME) ||
      e.dataTransfer.getData('text/plain');
    if (!moduleId) return;

    const mod = parseDraggedModule(moduleId);
    if (!mod) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const drop = {
      x: Math.max(8, e.clientX - rect.left - NODE_W / 2),
      y: Math.max(8, e.clientY - rect.top - NODE_H / 2),
    };
    const applied = applyModuleToFlow({ flow, moduleId, drop });
    if (!applied) return;
    onChange(applied.flow);
    onSelect(applied.selection);
  };

  return (
    <div
      className={[
        'flow-canvas',
        dropHover ? 'flow-canvas--drop-hover' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      tabIndex={0}
      onPointerMove={(e) => {
        onPointerMove(e);
        if (!wire) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setWire({
          from: wire.from,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }}
      onPointerUp={(e) => {
        setDrag(null);
        if (!wire) return;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const port = hit?.closest?.('[data-port="in"]') as HTMLElement | null;
        const raw = port?.dataset.endpoint;
        setWire(null);
        if (!raw) return;
        const to = endpointFromKey(raw);
        if (!to) return;
        onChange(connectNodes(flow, wire.from, to));
      }}
      onPointerLeave={() => {
        setDrag(null);
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Backspace' || e.key === 'Delete') && selectedEdge) {
          e.preventDefault();
          onChange(disconnectNodes(flow, selectedEdge));
          setSelectedEdge(null);
        }
      }}
      onClick={() => {
        onSelect(null);
        setSelectedEdge(null);
      }}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes(MODULE_DRAG_MIME) ||
          e.dataTransfer.types.includes('text/plain')
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={handleModuleDrop}
    >
      <div className="flow-canvas__grid" aria-hidden />
      <svg className="flow-canvas__edges">
        {edges.map((edge) => (
          <path
            key={edge.id}
            className={[
              'flow-canvas__edge',
              selectedEdge === edge.id ? 'flow-canvas__edge--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            d={`M ${edge.x1} ${edge.y1} C ${edge.x1 + 56} ${edge.y1}, ${edge.x2 - 56} ${edge.y2}, ${edge.x2} ${edge.y2}`}
            fill="none"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedEdge(edge.id);
            }}
          />
        ))}
        {wire ? (
          <path
            className="flow-canvas__edge flow-canvas__edge--draft"
            d={`M ${nodeCenter(positionOf(wire.from), 'out').x} ${nodeCenter(positionOf(wire.from), 'out').y} C ${nodeCenter(positionOf(wire.from), 'out').x + 56} ${nodeCenter(positionOf(wire.from), 'out').y}, ${wire.x - 56} ${wire.y}, ${wire.x} ${wire.y}`}
            fill="none"
          />
        ) : null}
      </svg>

      <FlowNode
        kind="trigger"
        endpoint="trigger"
        title="Trigger"
        subtitle={triggerSubtitle(flow)}
        badge={flow.trigger.kind === 'manual' ? 'manual' : flow.trigger.kind}
        status={nodeState?.trigger}
        x={flow.layout.trigger.x}
        y={flow.layout.trigger.y}
        selected={selection?.kind === 'trigger'}
        onPointerDown={(e) => onPointerDown(e, 'trigger')}
        onPortDown={(e) => beginWire(e, { kind: 'trigger' })}
      />

      {flow.steps.map((step) => {
        const pos = flow.layout.steps[step.id] ?? defaultStepPosition(0);
        return (
          <FlowNode
            key={step.id}
            kind="step"
            endpoint={`step:${step.id}`}
            title={step.label || step.kind}
            subtitle={stepSubtitle(step)}
            badge={step.kind}
            status={nodeState?.[step.id]}
            x={pos.x}
            y={pos.y}
            selected={selection?.kind === 'step' && selection.id === step.id}
            onPointerDown={(e) => onPointerDown(e, 'step', step.id)}
            onPortDown={(e) => beginWire(e, { kind: 'step', id: step.id })}
          />
        );
      })}

      <FlowNode
        kind="agent"
        endpoint="agent"
        title="Agent"
        subtitle={
          flow.agent.model
            ? `${flow.agent.mode} · ${flow.agent.model}`
            : `${flow.agent.mode} · ${flow.agent.autonomyPreset}`
        }
        badge={flow.agent.mode}
        status={nodeState?.agent}
        x={flow.layout.agent.x}
        y={flow.layout.agent.y}
        selected={selection?.kind === 'agent'}
        onPointerDown={(e) => onPointerDown(e, 'agent')}
        onPortDown={(e) => beginWire(e, { kind: 'agent' })}
      />

      {flow.delivery.map((d) => {
        const pos = flow.layout.delivery[d.id] ?? { x: 680, y: 120 };
        return (
          <FlowNode
            key={d.id}
            kind="delivery"
            endpoint={`delivery:${d.id}`}
            title="Delivery"
            subtitle={d.target || 'Configure target…'}
            badge={d.adapter}
            x={pos.x}
            y={pos.y}
            selected={
              selection?.kind === 'delivery' && selection.id === d.id
            }
            onPointerDown={(e) => onPointerDown(e, 'delivery', d.id)}
            onPortDown={(e) => beginWire(e, { kind: 'delivery', id: d.id })}
          />
        );
      })}

      <div className="flow-canvas__toolbar">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => addStep('command')}
        >
          + Command
        </button>
      </div>
    </div>
  );
}

function FlowNode(props: {
  kind: FlowNodeKind;
  endpoint: string;
  title: string;
  subtitle: string;
  badge: string;
  status?: NodeRunState;
  x: number;
  y: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPortDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className={[
        'flow-node',
        `flow-node--${props.kind}`,
        props.selected ? 'flow-node--selected' : '',
        props.status ? `flow-node--${props.status}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ transform: `translate(${props.x}px, ${props.y}px)` }}
      onPointerDown={props.onPointerDown}
      onClick={(e) => e.stopPropagation()}
      role="button"
      tabIndex={0}
    >
      <div
        className="flow-node__port flow-node__port--in"
        data-port="in"
        data-endpoint={props.endpoint}
      />
      <div
        className="flow-node__port flow-node__port--out"
        data-port="out"
        data-endpoint={props.endpoint}
        onPointerDown={props.onPortDown}
      />
      <NodeStatus status={props.status} />
      <div className="flow-node__badge">{props.badge}</div>
      <div className="flow-node__title">{props.title}</div>
      <div className="flow-node__subtitle" title={props.subtitle}>
        {props.subtitle}
      </div>
    </div>
  );
}

function NodeStatus(props: { status?: NodeRunState }) {
  if (!props.status) return null;
  return (
    <span
      className={`flow-node__status flow-node__status--${props.status}`}
      aria-label={props.status}
    >
      {props.status === 'running' || props.status === 'queued' ? (
        <span className="flow-node__spinner" />
      ) : props.status === 'done' ? (
        '✓'
      ) : (
        '!'
      )}
    </span>
  );
}

function endpointFromKey(raw: string): FlowEndpoint | null {
  if (raw === 'trigger' || raw === 'agent') return { kind: raw };
  if (raw.startsWith('step:')) return { kind: 'step', id: raw.slice(5) };
  if (raw.startsWith('delivery:')) {
    return { kind: 'delivery', id: raw.slice(9) };
  }
  return null;
}
