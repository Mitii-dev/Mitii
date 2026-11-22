import { type AppApi } from '../app/appApi';
import { mergeModelOptions } from '../app/modelOptions';
import { applyBootstrap } from '../hostMessages/applyBootstrap';
import { type HostToWebviewMessage } from '../protocol';

export function handleSettingsMessage(msg: HostToWebviewMessage, api: AppApi): boolean {
  const {
    embeddingSourceDraftRef,
    maximumIndexFilesDraftRef,
    setConnectionMessage,
    setCostRates,
    setCustomModel,
    setError,
    setNav,
    setNotice,
    setOnboardingRequired,
    setRefreshingModels,
    setSettingsSaving,
    setSettingsTab,
    setTestingConnection,
    settingsSavingRef,
    updateProvider,
  } = api;

  let handled = true;
  switch (msg.type) {
    case 'bootstrap':
    case 'settings':
      applyBootstrap(msg, api);
      break;
    case 'openSettings':
      setNav('settings');
      if (msg.tab) setSettingsTab(msg.tab);
      break;
    case 'setTab':
      setNav(msg.tab);
      break;
    case 'workspaceNotice':
      setNotice(msg.notice);
      break;
    case 'onboarding':
      setOnboardingRequired(msg.required);
      break;
    case 'provider.connectionResult':
      setTestingConnection(Boolean(msg.testing));
      setConnectionMessage(msg.message);
      if (Array.isArray(msg.models)) {
        updateProvider((p) => ({
          ...p,
          availableModels: mergeModelOptions(msg.models ?? [], p.model),
          connectionOk: msg.ok,
          connectionStatus: msg.message,
        }));
        if ((msg.models?.length ?? 0) > 0) {
          setCustomModel(false);
        }
      } else if (!msg.testing) {
        updateProvider((p) => ({
          ...p,
          connectionOk: msg.ok,
          connectionStatus: msg.message,
        }));
      }
      break;
    case 'provider.models':
      setRefreshingModels(false);
      updateProvider((p) => ({
        ...p,
        availableModels: mergeModelOptions(msg.models, p.model),
      }));
      break;
    case 'settings.saved':
      if (settingsSavingRef.current && msg.ok) {
        embeddingSourceDraftRef.current = undefined;
        maximumIndexFilesDraftRef.current = undefined;
      }
      settingsSavingRef.current = false;
      setSettingsSaving(false);
      if (!msg.ok) {
        setError(msg.message ?? 'Settings could not be saved.');
      }
      break;
    case 'modelPricing':
      setCostRates(msg.rates);
      break;
    default:
      handled = false;
  }
  return handled;
}
