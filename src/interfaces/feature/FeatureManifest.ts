export type FeatureEdition = 'ce' | 'ee';

export interface FeatureManifest {
  id: string;
  apiVersion: string;
  edition: FeatureEdition;
  version: string;
  displayName?: string;
  description?: string;
  requires?: readonly string[];
  optional?: readonly string[];
  hostCapabilities?: readonly string[];
}

export interface ContributionOwner {
  featureId: string;
  edition: FeatureEdition;
}
