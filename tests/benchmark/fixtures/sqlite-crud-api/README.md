# sqlite-crud-api

Express + `better-sqlite3` task API. `src/db.js` creates `db.sqlite` (gitignored,
created fresh on first boot) with `tasks`, `tags`, and `task_tags` tables. Only
`GET /tasks` and `POST /tasks` exist in the committed baseline, through
`src/services/taskService.js`. Used for `api-build/cases/sqlite-crud.jsonl`: the
agent adds `PATCH /tasks/:id`, `DELETE /tasks/:id`, `GET /tasks?tag=<name>`,
`POST /tasks/:id/tags`, and `DELETE /tasks/:id/tags/:tagId` through the same
service layer, graded by live HTTP requests plus a direct SQLite read of the
final row state.
