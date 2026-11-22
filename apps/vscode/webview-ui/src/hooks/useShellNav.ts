import { useCallback, useState } from 'react';
import { postToHost } from '../bridge';
import { type SettingsTab, type UiNav } from '../protocol';

export function useShellNav() {
  const [nav, setNav] = useState<UiNav>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('model');

  const [onboardingRequired, setOnboardingRequired] = useState(false);

  const navigate = useCallback(
    (next: UiNav, nextSettingsTab?: SettingsTab) => {
      setNav(next);
      if (nextSettingsTab) setSettingsTab(nextSettingsTab);
      postToHost({
        type: 'navigate',
        nav: next,
        settingsTab: nextSettingsTab,
      });
    },
    [],
  );

  return {
    nav,
    setNav,
    settingsTab,
    setSettingsTab,
    onboardingRequired,
    setOnboardingRequired,
    navigate,
  };
}

export type ShellNavApi = ReturnType<typeof useShellNav>;
