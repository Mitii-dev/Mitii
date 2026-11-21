/** Live model pricing lookup and active profile selection. */

import { useEffect } from 'react';
import { isPricedCloudProvider } from '@mitii/ui-core';
import { fetchModelPricing } from '../../api.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useProviderState } from './useProviderState.js';

export function useModelPricing(deps: Pick<
    ReturnType<typeof useEngineSnapshot>,
    'settings' | 'engine'
  > &
  Pick<
    ReturnType<typeof useProviderState>,
    'setCostRates' | 'profiles' | 'activeProfileId'
  >) {
  const {
    settings,
    engine,
    setCostRates,
    profiles,
    activeProfileId,
  } = deps;

  useEffect(() => {
    const preset = settings.provider.preset || settings.provider.type;
    const model = settings.provider.model;
    const providerBaseUrl = settings.provider.baseUrl;
    if (
      !isPricedCloudProvider(preset, providerBaseUrl) ||
      !model.trim() ||
      !engine
    ) {
      setCostRates(null);
      return;
    }
    let cancelled = false;
    void fetchModelPricing({
      ...engine,
      preset,
      model,
      providerBaseUrl,
    })
      .then((result) => {
        if (!cancelled) setCostRates(result.rates);
      })
      .catch(() => {
        if (!cancelled) setCostRates(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    engine?.baseUrl,
    engine?.token,
    settings.provider.preset,
    settings.provider.type,
    settings.provider.model,
    settings.provider.baseUrl,
  ]);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  return {
    activeProfile,
  };
}
