/** Full-screen loader while switching workspaces. */

import logoUrl from '../assets/mitii-logo.svg';
import type { AppModel } from '../app/useAppModel.js';

export function WorkspaceLoader({ m }: { m: AppModel }) {
  const {
    workspaceLoading,
    workspaceLoadingLabel,
  } = m;

  return workspaceLoading ? (
    <div className="workspace-loader" role="status" aria-live="polite">
      <div className="workspace-loader__card">
        <img
          className="workspace-loader__logo"
          src={logoUrl}
          alt=""
          width={72}
          height={72}
          decoding="async"
        />
        <strong className="workspace-loader__brand">Mitii</strong>
        <p className="workspace-loader__label">{workspaceLoadingLabel}</p>
        <div
          className="workspace-loader__track"
          aria-hidden
        >
          <div className="workspace-loader__bar" />
        </div>
      </div>
    </div>
  ) : null;
}
