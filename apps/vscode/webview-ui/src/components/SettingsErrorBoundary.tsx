import { Component, type ErrorInfo, type ReactNode } from 'react';

interface SettingsErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface SettingsErrorBoundaryState {
  error: Error | null;
}

export class SettingsErrorBoundary extends Component<
  SettingsErrorBoundaryProps,
  SettingsErrorBoundaryState
> {
  state: SettingsErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SettingsErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Mitii settings failed to render', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="settings-crash">
        <h2>Settings could not be shown</h2>
        <p className="field-hint">
          Chat is still available. Open Settings again after reset, or use
          Developer → Reset budgets to defaults if a token-budget value is
          invalid.
        </p>
        <pre className="settings-crash__error mono">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          className="btn"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
        >
          Reload settings
        </button>
      </div>
    );
  }
}
