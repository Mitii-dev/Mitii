import { useEffect, useState } from 'react';
import { uid } from '../app/turnHelpers';
import { postToHost } from '../bridge';
import { type AutomationRunView, type AutomationSpecView } from '../protocol';
import type { ShellNavApi } from './useShellNav';

export function useAutomations(deps: ShellNavApi) {
  const {
    nav,
  } = deps;

  const [automationSpecs, setAutomationSpecs] = useState<AutomationSpecView[]>(
    [],
  );
  const [automationRuns, setAutomationRuns] = useState<AutomationRunView[]>([]);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);

  const requestAutomations = () => {
    setAutomationLoading(true);
    postToHost({ type: 'requestAutomations', requestId: uid('auto') });
  };

  useEffect(() => {
    if (nav === 'automations') requestAutomations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  return {
    automationSpecs,
    setAutomationSpecs,
    automationRuns,
    setAutomationRuns,
    automationLoading,
    setAutomationLoading,
    automationError,
    setAutomationError,
    requestAutomations,
  };
}

export type AutomationsApi = ReturnType<typeof useAutomations>;
