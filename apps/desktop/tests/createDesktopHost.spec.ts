import { describe, expect, it } from 'vitest';

import {
  DesktopUnderstandingLlmPort,
  createEchoDesktopClient,
  loadDesktopMitiiConfig,
} from '../src/engine/createDesktopHost.js';

describe('createDesktopHost', () => {
  it('loads empty config when .mitii/config.json is absent', () => {
    expect(loadDesktopMitiiConfig('/tmp/mitii-desktop-missing-config')).toEqual(
      {},
    );
  });

  it('builds an echo client without remote providers', () => {
    const client = createEchoDesktopClient(process.cwd());
    expect(client).toBeTruthy();
  });

  it('understanding port emits structured JSON then completed', async () => {
    const port = new DesktopUnderstandingLlmPort();
    const events = [];
    for await (const event of port.complete({} as never)) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({ type: 'content_delta' });
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      finishReason: 'stop',
    });
  });
});
