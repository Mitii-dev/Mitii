import SYMBOL_LOGO from '../../../media/mitii-logo.png';
import { type AppApi } from '../app/appApi';
import { postToHost } from '../bridge';
import { OnboardingPanel } from '../components/OnboardingPanel';

export function OnboardingView({ api }: { api: AppApi }) {
  const {
    index,
    navigate,
    setOnboardingRequired,
  } = api;

  return (
    <div className="app">
      <header className="shell-header">
        <div className="brand" aria-label=">Mitii.dev_">
          <img className="brand-symbol" src={SYMBOL_LOGO} alt="" />
          <div className="brand-sub">First-run setup</div>
        </div>
      </header>
      <OnboardingPanel
        index={index}
        onIndex={() => postToHost({ type: 'index.reindex' })}
        onComplete={() => {
          postToHost({ type: 'completeOnboarding' });
          setOnboardingRequired(false);
        }}
        onOpenSettings={() => {
          setOnboardingRequired(false);
          navigate('settings', 'model');
        }}
      />
    </div>
  );
}
