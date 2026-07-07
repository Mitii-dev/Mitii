function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

class Logger {
  constructor(scope) {
    this.scope = scope;
  }

  info(message) {
    console.log(`[${this.scope}] ${message}`);
  }
}

module.exports = { validateEmail, Logger };
