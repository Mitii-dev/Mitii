/**
 * Redact common secret patterns before tickets, evidence packs, or delivery.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: 'bearer',
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  },
  {
    name: 'gh_pat',
    re: /\bghp_[A-Za-z0-9]{36,}\b/g,
  },
  {
    name: 'github_pat',
    re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: 'slack_token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: 'openai',
    re: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: 'anthropic',
    re: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g,
  },
  {
    name: 'generic_api_key',
    // Skip values already replaced by a more specific pattern above.
    re: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?(?!\[REDACTED:)[^\s'"]{8,}/gi,
  },
  {
    name: 'private_key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
];

export function redactSecrets(text: string): {
  text: string;
  redacted: boolean;
} {
  let out = text;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    const next = out.replace(pattern.re, `[REDACTED:${pattern.name}]`);
    if (next !== out) {
      redacted = true;
      out = next;
    }
  }
  return { text: out, redacted };
}
