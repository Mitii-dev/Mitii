const express = require('express');
const { reserveStock } = require('./routes/orders');
const db = require('./db'); // TODO.md: db.js was never committed; start currently crashes

const app = express();
app.use(express.json());

app.post('/orders/reserve', (req, res) => {
  const { stock, quantity } = req.body ?? {};
  const result = reserveStock({ stock }, quantity);
  if (!result.ok) return res.status(409).json(result);
  db.recordReservation(quantity);
  return res.status(200).json(result);
});

module.exports = app;
