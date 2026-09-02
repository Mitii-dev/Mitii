import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import usersRouter from './routes/users.js';

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Only bind a port when this file is the process entrypoint. Tests import the
// app and call listen(0) themselves; auto-listen on import leaves the event
// loop open and hangs node --test.
const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryFile === thisFile || process.env.MITII_BENCH_FORCE_LISTEN === '1') {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`listening on ${port}`);
  });
}

export default app;
