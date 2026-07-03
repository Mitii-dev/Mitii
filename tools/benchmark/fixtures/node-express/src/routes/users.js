import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  // BUG: wrong message for benchmark agent fix task
  res.json({ status: 'ok', users: [] });
});

router.get('/:id', (req, res) => {
  res.json({ id: req.params.id, name: 'Sample User' });
});

export default router;