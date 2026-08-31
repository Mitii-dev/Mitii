import type {
  DeliveryAdapter,
  DeliverySender,
  DeliveryTarget,
} from '@mitii/automation';
import { createWebhookDeliverySender } from '@mitii/automation';

import { createChatDeliverySender } from './chatSenders.js';
import { createGithubDeliverySender } from './githubSenders.js';

export { formatDeliveryMessage } from './formatMessage.js';

export interface CreateCompositeDeliverySenderOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Override individual adapters (tests). */
  overrides?: Partial<Record<DeliveryAdapter, DeliverySender>>;
}

/**
 * Routes DeliveryBus flushes to webhook / chat / GitHub senders.
 * Lives in @mitii/host so @mitii/automation stays free of chat SDKs.
 */
export function createCompositeDeliverySender(
  options: CreateCompositeDeliverySenderOptions = {},
): DeliverySender {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const webhook = createWebhookDeliverySender({ fetchImpl });
  const chat = createChatDeliverySender({ env, fetchImpl });
  const github = createGithubDeliverySender({
    env,
    cwd: env.MITII_DELIVERY_CWD,
  });
  const overrides = options.overrides ?? {};

  return {
    async send(input) {
      const override = overrides[input.adapter];
      if (override) return override.send(input);

      switch (input.adapter) {
        case 'webhook':
          return webhook.send(input);
        case 'slack':
        case 'discord':
        case 'telegram':
          return chat.send(input);
        case 'github_check':
        case 'github_comment':
          return github.send(input);
        default:
          return {
            ok: false,
            error: `unsupported delivery adapter: ${String(input.adapter)}`,
          };
      }
    },
  };
}

export type { DeliveryTarget };
