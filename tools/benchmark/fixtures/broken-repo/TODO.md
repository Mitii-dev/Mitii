# TODO

- [ ] Commit `src/db.js` — `npm start` crashes with `Cannot find module './db'`.
- [ ] Fix `reserveStock` in `src/routes/orders.js` — boundary case (reserving exactly the
      remaining stock) is rejected; `npm test` currently fails on this case.
