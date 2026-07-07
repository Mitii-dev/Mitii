const express = require('express');
const { validateEmail, Logger } = require('@mono/shared');

const app = express();
app.use(express.json());
const logger = new Logger('api');

app.post('/signup', (req, res) => {
  const { email } = req.body ?? {};
  if (!validateEmail(email)) {
    logger.info(`rejected invalid email: ${email}`);
    return res.status(400).json({ error: 'invalid email' });
  }
  logger.info(`accepted signup for ${email}`);
  return res.status(201).json({ email });
});

module.exports = app;
