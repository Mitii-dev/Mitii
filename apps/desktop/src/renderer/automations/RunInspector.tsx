/**
 * Run view — status, live lines, and the answer. The raw report stays folded.
 */

export interface AutomationRunDetailView {
  run: {
    runId: string;
    specId: string;
    status: string;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
    triggerKind?: string;
    reportPath?: string | null;
    sessionId?: string | null;
  };
  spec: { specId: string; title: string } | null;
  reportMarkdown: string | null;
  deliveries: Array<{
    deliveryId: string;
    adapter: string;
    status: string;
    error: string | null;
    attempts: number;
    updatedAt: string;
  }>;
  triggerEvent: {
    eventId: string;
    eventType: string;
    source: string;
    subject: string | null;
    occurredAt: string;
    processingStatus: string;
    payloadJson: string | null;
  } | null;
  timeline: Array<{
    at: string;
    label: string;
    detail?: string;
    tone?: 'ok' | 'warn' | 'err' | 'info';
  }>;
  live?: {
    nodes: Record<string, 'queued' | 'running' | 'done' | 'failed'>;
    lines: Array<{ at: string; text: string; tone?: 'info' | 'ok' | 'err' }>;
  } | null;
}

interface RunInspectorProps {
  detail: AutomationRunDetailView | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onCancel?: (runId: string) => void;
}

export function RunInspector(props: RunInspectorProps) {
  const { detail, loading, error, onClose, onCancel } = props;
  const answer = detail ? extractAnswer(detail.reportMarkdown) : '';
  const live =
    detail?.run.status === 'running' || detail?.run.status === 'queued';
  const failed = detail?.run.status === 'failed';

  return (
    <div className="run-view">
      <header className="run-view__header">
        <div>
          <p className="run-view__kicker">Run</p>
          <h3 className="run-view__title">
            {detail?.spec?.title ?? 'Automation'}
          </h3>
          <p className="run-view__meta">
            {detail
              ? `${labelStatus(detail.run.status)} · ${formatWhen(detail.run.createdAt)} · ${detail.run.triggerKind ?? 'manual'}`
              : 'Select a run'}
          </p>
        </div>
        <div className="run-inspector__header-actions">
          {detail && live && onCancel ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onCancel(detail.run.runId)}
            >
              Cancel
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {loading && !detail ? <p className="run-view__meta">Loading run…</p> : null}
      {error ? <p className="run-view__error">{error}</p> : null}

      {detail ? (
        <>
          <div className={`run-view__banner run-view__banner--${detail.run.status}`}>
            <span className={`automations-run-status automations-run-status--${detail.run.status}`}>
              {labelStatus(detail.run.status)}
            </span>
            <span>{durationLabel(detail)}</span>
          </div>

          {failed && detail.run.error ? (
            <p className="run-view__error">{friendly(detail.run.error)}</p>
          ) : null}

          <section className="run-view__section">
            <h4>Log</h4>
            {detail.live?.lines?.length ? (
              <ol className="run-view__log">
                {detail.live.lines.map((line, index) => (
                  <li key={`${line.at}-${index}`} className={`run-view__log-line run-view__log-line--${line.tone ?? 'info'}`}>
                    <time>{formatClock(line.at)}</time>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="run-view__log">
                {detail.timeline.map((item, index) => (
                  <li key={`${item.at}-${index}`} className={`run-view__log-line run-view__log-line--${item.tone ?? 'info'}`}>
                    <time>{formatClock(item.at)}</time>
                    <span>
                      {item.label}
                      {item.detail ? ` — ${friendly(item.detail)}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {answer ? (
            <section className="run-view__section">
              <h4>{failed ? 'Partial output' : 'Output'}</h4>
              <div className="run-view__output">{answer}</div>
            </section>
          ) : live ? (
            <p className="run-view__meta">Waiting for output…</p>
          ) : null}

          {detail.reportMarkdown ? (
            <details className="run-view__details">
              <summary>Raw report</summary>
              <pre className="run-view__raw">{detail.reportMarkdown}</pre>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function labelStatus(status: string): string {
  if (status === 'done') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'running') return 'Running';
  if (status === 'queued') return 'Queued';
  if (status === 'cancelled') return 'Cancelled';
  return status;
}

function friendly(message: string): string {
  if (/aborted due to timeout|timed out|operation was aborted/i.test(message)) {
    return 'The model request timed out before it finished. Trigger again, or choose a faster model.';
  }
  return message.replace(/^trigger=/, '');
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function durationLabel(detail: AutomationRunDetailView): string {
  const start = detail.run.startedAt ?? detail.run.createdAt;
  const end = detail.run.completedAt ?? (detail.run.status === 'running' ? new Date().toISOString() : '');
  if (!start || !end) return '';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function extractAnswer(markdown: string | null): string {
  if (!markdown) return '';
  const match = markdown.split(/^## Answer\s*$/m)[1];
  if (!match) return '';
  const body = match.split(/^## /m)[0] ?? '';
  const text = body.trim();
  if (!text || text === '_none_') return '';
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}
