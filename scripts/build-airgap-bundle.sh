#!/usr/bin/env bash
set -euo pipefail

version="$(node -p "require('./package.json').version")"
out="${MITII_AIRGAP_OUT:-dist-airgap/mitii-${version}}"
mkdir -p "$out"

pnpm run package
cp ./*.vsix "$out/" 2>/dev/null || true
cp scripts/install.sh scripts/install.ps1 "$out/"
cp README.md LICENSE "$out/"

cat > "$out/README.md" <<EOF
# Mitii Air-Gapped Bundle

Version: $version

Contents:
- VSIX extension package
- Install scripts
- License and product README

Recommended offline install:

\`\`\`bash
code --install-extension ./mitii-ai-agent-${version}.vsix
\`\`\`
EOF

(cd "$(dirname "$out")" && tar -czf "mitii-airgap-${version}.tar.gz" "$(basename "$out")")
echo "Created $(dirname "$out")/mitii-airgap-${version}.tar.gz"
