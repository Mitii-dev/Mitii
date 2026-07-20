#!/usr/bin/env bash
# Maintainer utility: refresh src/features/ce/skills/bundled/ from a local checkout (no runtime git pull in the extension).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="${MITII_BUNDLED_SKILLS_DIR:-$ROOT_DIR/src/features/ce/skills/bundled}"
SOURCE_DIR="${AGENT_SKILLS_SOURCE_DIR:-}"

usage() {
  cat <<'EOF'
Sync selected upstream skills into the VS Code extension bundle.

Usage:
  AGENT_SKILLS_SOURCE_DIR=/path/to/agent-skills/skills bash scripts/sync-bundled-skills.sh
  bash scripts/sync-bundled-skills.sh /path/to/agent-skills/skills

Copies the listed Tier-1 SKILL.md folders from an upstream agent-skills checkout into
src/features/ce/skills/bundled/. Mitii-owned skills (git-*, github-*, audit-cleanup, log-audit, etc.)
live in this tree and are not overwritten unless they appear in SKILLS below.

Does not run at extension runtime — commit the result and ship it in the VSIX.

After sync, run: pnpm run skills:validate
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  SOURCE_DIR="$1"
fi

if [[ -z "$SOURCE_DIR" || ! -d "$SOURCE_DIR" ]]; then
  echo "Set AGENT_SKILLS_SOURCE_DIR or pass the agent-skills/skills directory." >&2
  usage >&2
  exit 1
fi

# Upstream playbooks that Mitii still vendors. Keep in sync with enterprise authoring
# (Quick Reference, ≤240-char descriptions). Do not reintroduce git-workflow-and-versioning;
# Mitii uses the git-* / github-* skill family instead.
SKILLS=(
  planning-and-task-breakdown
  debugging-and-error-recovery
  performance-optimization
  test-driven-development
  code-review-and-quality
  using-agent-skills
)

mkdir -p "$DEST_DIR"

for skill in "${SKILLS[@]}"; do
  src="$SOURCE_DIR/$skill"
  if [[ ! -f "$src/SKILL.md" ]]; then
    echo "Missing $src/SKILL.md" >&2
    exit 1
  fi
  rm -rf "$DEST_DIR/$skill"
  cp -R "$src" "$DEST_DIR/$skill"
  echo "Synced $skill"
done

echo "Done. src/features/ce/skills/bundled now contains $(find "$DEST_DIR" -name SKILL.md | wc -l | tr -d ' ') skill(s)."
echo "Run: pnpm run skills:validate"
