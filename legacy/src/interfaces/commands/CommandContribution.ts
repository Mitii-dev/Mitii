export interface CommandContribution {
  id: string;
  owner: string;
  title: string;
  category?: string;
  legacyAliases?: readonly string[];
  capabilities?: readonly string[];
}
