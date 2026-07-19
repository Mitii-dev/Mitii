import type { FeatureModule, FeatureRegistrationContext } from '../../interfaces/feature';
import { vscodeContextSourceFactories } from '../../adapters/vscode/context/factories/vscodeContextSources';

/**
 * Registers the handful of context sources that genuinely need the `vscode` API (editor/tab
 * state, VS Code diagnostics). Lives in `composition/ce`, not `features/ce`, because
 * `features/ce/**` may never import `adapters/**` — `composition/ce/**` is the one CE-side layer
 * explicitly allowed to bridge CE features with adapter implementations.
 */
export const vscodeHostFeature: FeatureModule = {
  manifest: {
    id: 'ce.host.vscode.context',
    apiVersion: '1',
    edition: 'ce',
    version: '1.0.0',
    displayName: 'VS Code Host Context Sources',
    description: 'Editor/tab state and VS Code diagnostics context sources.',
    requires: ['ce.context.indexing'],
  },
  register(context: FeatureRegistrationContext) {
    for (const contribution of vscodeContextSourceFactories) {
      context.contextSources.register(contribution);
    }
  },
};
