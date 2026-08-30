export function getConnectorSystemRules(connectorId: string): string {
  return [
    `Keep answers compact and optimized for this ${connectorId} integration unless the user asks for detail.`,
    'Prefer short paragraphs and bullet lists over long essays.',
    'When a request needs workspace tools, say what you will do briefly before doing it.',
  ].join('\n');
}

export function getConnectorFirstContactMessage(): string {
  return [
    'Connected to Mitii.',
    'Chat history is kept per thread.',
    'Send /new to start a fresh session, /whereami for thread details, or /help for commands.',
  ].join('\n');
}
