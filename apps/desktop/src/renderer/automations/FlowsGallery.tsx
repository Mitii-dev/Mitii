/**
 * Flow tile gallery — Automations home.
 */

import type {
  AutomationSpecView,
  AutomationTemplateView,
} from './AutomationsPanel.js';

export interface FlowsGalleryProps {
  specs: AutomationSpecView[];
  templates?: AutomationTemplateView[];
  loading?: boolean;
  triggeringId?: string | null;
  onOpen: (specId: string) => void;
  onNew: () => void;
  onTrigger: (specId: string) => void;
  onPause: (specId: string) => void;
  onResume: (specId: string) => void;
  onDelete?: (specId: string) => void;
  onApplyTemplate?: (templateId: string) => void;
}

function triggerLabel(spec: AutomationSpecView): string {
  if (spec.triggerKind === 'schedule' && spec.scheduleExpr) {
    return `cron · ${spec.scheduleExpr}`;
  }
  if (spec.eventType) return spec.eventType;
  return spec.triggerKind;
}

export function FlowsGallery(props: FlowsGalleryProps) {
  const {
    specs,
    templates = [],
    loading,
    triggeringId,
    onOpen,
    onNew,
    onTrigger,
    onPause,
    onResume,
    onDelete,
    onApplyTemplate,
  } = props;

  return (
    <div className="flows-gallery">
      <div className="flows-gallery__grid">
        <button
          type="button"
          className="flow-tile flow-tile--new"
          onClick={onNew}
        >
          <span className="flow-tile__badge">New</span>
          <span className="flow-tile__title">New flow</span>
          <span className="flow-tile__meta">
            Blank Trigger → Steps → Agent canvas
          </span>
        </button>

        {specs.map((spec) => (
          <article
            key={spec.specId}
            className={[
              'flow-tile',
              spec.enabled ? 'flow-tile--on' : 'flow-tile--off',
            ].join(' ')}
          >
            <button
              type="button"
              className="flow-tile__open"
              onClick={() => onOpen(spec.specId)}
            >
              <span className="flow-tile__badge">
                {spec.enabled ? 'Active' : 'Paused'}
              </span>
              <span className="flow-tile__title">{spec.title}</span>
              <span className="flow-tile__meta">{triggerLabel(spec)}</span>
              {spec.nextRunAt ? (
                <span className="flow-tile__meta">next {spec.nextRunAt}</span>
              ) : null}
              {spec.autonomyPreset ? (
                <span className="flow-tile__chip">{spec.autonomyPreset}</span>
              ) : null}
            </button>
            <div className="flow-tile__actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onOpen(spec.specId)}
              >
                Open
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={triggeringId === spec.specId}
                onClick={() => onTrigger(spec.specId)}
              >
                {triggeringId === spec.specId ? 'Triggering…' : 'Trigger'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  spec.enabled ? onPause(spec.specId) : onResume(spec.specId)
                }
              >
                {spec.enabled ? 'Pause' : 'Resume'}
              </button>
              {onDelete ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    if (
                      window.confirm(`Delete automation “${spec.title}”?`)
                    ) {
                      onDelete(spec.specId);
                    }
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {specs.length === 0 && !loading ? (
        <p className="automations-panel__empty">
          No flows yet. Create one or start from a template. Specs live in{' '}
          <code>.mitii/cron</code>.
        </p>
      ) : null}

      {templates.length > 0 ? (
        <section className="flows-gallery__templates">
          <h3 className="automations-panel__section-title">Templates</h3>
          <div className="automations-templates">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className="automations-template"
                onClick={() => onApplyTemplate?.(t.id)}
              >
                <span className="automations-template__cat">{t.category}</span>
                <span className="automations-template__title">{t.title}</span>
                <span className="automations-template__desc">
                  {t.description}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
