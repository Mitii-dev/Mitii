import { DaemonClient, DaemonSessionClient } from '../src/daemon';

const client = new DaemonClient({
  baseUrl: process.env.MITII_DAEMON_URL ?? 'http://127.0.0.1:4310',
  token: process.env.MITII_SERVER_TOKEN,
});

const session = await DaemonSessionClient.createOrAttach(client, {
  cwd: process.cwd(),
  mode: 'agent',
  approval: 'manual',
  runtime: 'stub',
});

void (async () => {
  for await (const event of session.events()) {
    if (event.type === 'approval_required') {
      await session.respondToPermission(event.id, 'approved');
    }
    console.log(JSON.stringify(event));
    if (event.type === 'done' || event.type === 'error') break;
  }
})();

await session.prompt({ message: 'Say hello from the daemon quickstart.' });
