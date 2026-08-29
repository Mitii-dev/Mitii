const PRIVATE_TAG_RE = /<private>[\s\S]*?<\/private>/gi;

const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|secret|token|password|credential|auth)[\s]*[=:]\s*["']?[A-Za-z0-9_\-/.+]{20,}["']?/gi,
  /Bearer\s+[A-Za-z0-9._\-+/=]{20,}/gi,
  /sk-proj-[A-Za-z0-9\-_]{20,}/g,
  /(?:sk|pk|rk|ak)-[A-Za-z0-9][A-Za-z0-9\-_]{19,}/g,
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  /gh[pus]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[A-Za-z0-9\-_]{35}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /glpat-[A-Za-z0-9\-_]{20,}/g,
];

/**
 * Strip tagged private spans and common secret shapes before persist.
 */
export function redactMemoryContent(input: string): {
  content: string;
  redacted: boolean;
} {
  let content = input.replace(PRIVATE_TAG_RE, "[REDACTED]");
  for (const source of SECRET_PATTERNS) {
    content = content.replace(new RegExp(source.source, source.flags), "[REDACTED_SECRET]");
  }
  return {
    content,
    redacted: content !== input,
  };
}
