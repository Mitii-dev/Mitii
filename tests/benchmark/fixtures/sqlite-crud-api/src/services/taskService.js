import { db } from '../db.js';

export function listTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY id').all();
}

export function getTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

export function createTask(title) {
  const createdAt = new Date().toISOString();
  const info = db.prepare('INSERT INTO tasks (title, done, created_at) VALUES (?, 0, ?)').run(title, createdAt);
  return getTask(info.lastInsertRowid);
}
