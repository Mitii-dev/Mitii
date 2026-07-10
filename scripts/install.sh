#!/usr/bin/env sh
set -eu

VERSION="${MITII_VERSION:-latest}"
BASE_URL="${MITII_RELEASE_BASE_URL:-https://github.com/codewithshinde/thunder-ai-agent/releases/download}"
INSTALL_DIR="${MITII_INSTALL_DIR:-$HOME/.mitii/bin}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="mitii-${os}-${arch}.tar.gz"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/codewithshinde/thunder-ai-agent/releases/latest/download/$asset"
  sums_url="https://github.com/codewithshinde/thunder-ai-agent/releases/latest/download/SHA256SUMS"
else
  url="$BASE_URL/$VERSION/$asset"
  sums_url="$BASE_URL/$VERSION/SHA256SUMS"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$INSTALL_DIR"
curl -fsSL "$url" -o "$tmp/$asset"
if curl -fsSL "$sums_url" -o "$tmp/SHA256SUMS"; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$tmp" && grep " $asset$" SHA256SUMS | sha256sum -c -)
  else
    expected="$(grep " $asset$" "$tmp/SHA256SUMS" | awk '{print $1}')"
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || { echo "SHA256 mismatch" >&2; exit 1; }
  fi
fi
tar -xzf "$tmp/$asset" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/mitii"
echo "Installed mitii to $INSTALL_DIR/mitii"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add $INSTALL_DIR to PATH to run mitii from any shell." ;;
esac
