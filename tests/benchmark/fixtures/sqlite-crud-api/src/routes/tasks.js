import { Router } from 'express';
import { listTasks, createTask } from '../services/taskService.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(listTasks());
});

router.post('/', (req, res) => {
  const { title } = req.body ?? {};
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const task = createTask(title);
  res.status(201).json(task);
});

export default router;
