export const SESSION_CONTROL_MIN_MESSAGES_TO_KEEP = 6 as const;

export const SESSION_CONTROL_HELP_TEXT = [
  "Mitii session commands:",
  "  /stop     — cancel the active run",
  "  /new      — start a fresh chat (host clears session)",
  "  /clear    — clear this chat (host clears session)",
  "  /compact  — compact conversation history under the window budget",
  "  /help     — show this list",
  "  /status   — show session control status",
  "  /resume   — ask host to resume a prior session (pass session id as args)",
  "  /ask|/plan|/agent <prompt> — set interaction mode for this turn",
].join("\n");
