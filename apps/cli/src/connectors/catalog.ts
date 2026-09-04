import type { ConnectorCatalogEntry } from './types.js';

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    name: 'telegram',
    description:
      'Telegram Bot API long-poll bridge into Mitii CLI agent sessions',
  },
  {
    name: 'discord',
    description: 'Discord bot gateway bridge into Mitii CLI agent sessions',
  },
  {
    name: 'slack',
    description: 'Slack Socket Mode bridge into Mitii CLI agent sessions',
  },
];

export function listConnectorCatalog(): ConnectorCatalogEntry[] {
  return CONNECTOR_CATALOG.map((entry) => ({ ...entry }));
}
