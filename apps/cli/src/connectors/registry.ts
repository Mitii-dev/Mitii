import { CONNECTOR_CATALOG, listConnectorCatalog } from './catalog.js';
import type { ConnectCommandDefinition } from './types.js';

type ConnectorRegistryEntry = {
  name: string;
  description: string;
  load: () => Promise<ConnectCommandDefinition>;
};

const connectorDescriptions = new Map(
  CONNECTOR_CATALOG.map((entry) => [entry.name, entry.description]),
);

const registry = new Map<string, ConnectorRegistryEntry>([
  [
    'telegram',
    {
      name: 'telegram',
      description:
        connectorDescriptions.get('telegram') ?? 'Telegram Bot API bridge',
      load: async () =>
        (await import('./adapters/telegram.js')).telegramConnector,
    },
  ],
  [
    'discord',
    {
      name: 'discord',
      description:
        connectorDescriptions.get('discord') ?? 'Discord bot gateway bridge',
      load: async () =>
        (await import('./adapters/discord.js')).discordConnector,
    },
  ],
  [
    'slack',
    {
      name: 'slack',
      description:
        connectorDescriptions.get('slack') ?? 'Slack Socket Mode bridge',
      load: async () => (await import('./adapters/slack.js')).slackConnector,
    },
  ],
]);

export function listConnectors(): Array<
  Pick<ConnectorRegistryEntry, 'name' | 'description'>
> {
  return listConnectorCatalog();
}

export async function getConnector(
  name: string,
): Promise<ConnectCommandDefinition | undefined> {
  const entry = registry.get(name.trim().toLowerCase());
  return entry ? entry.load() : undefined;
}
