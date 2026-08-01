import express from 'express';
import usersRouter from './routes/users.js';

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});

export default app;
