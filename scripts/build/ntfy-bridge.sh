#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

OUT_DIR="${OUT_DIR:-dist/ntfy-bridge}"
MODULE_DIR="ntfy-bridge"
BIN_DIR="$OUT_DIR/module/bin"
CERT_DIR="$OUT_DIR/module/certs"
MODULE_OUT="$OUT_DIR/ntfy-bridge-magisk.zip"
CACERT_SOURCE="${CACERT_SOURCE:-/etc/ssl/cert.pem}"

mkdir -p "$BIN_DIR" "$CERT_DIR"
rm -f "$MODULE_OUT"

echo "=== Building ntfy-bridge daemon ==="
(
  cd "$MODULE_DIR"
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 GOCACHE="${GOCACHE:-/tmp/gocache}" \
    go build -ldflags="-s -w" -o "../$BIN_DIR/ntfy-bridged" .
)

echo "=== Preparing Magisk module ==="
if [ ! -f "$CACERT_SOURCE" ]; then
  echo "ERROR: CA bundle not found at $CACERT_SOURCE"
  exit 1
fi

cp "$MODULE_DIR/module.prop" "$OUT_DIR/module/module.prop"
cp "$MODULE_DIR/service.sh" "$OUT_DIR/module/service.sh"
cp "$MODULE_DIR/customize.sh" "$OUT_DIR/module/customize.sh"
cp "$CACERT_SOURCE" "$CERT_DIR/cacert.pem"
chmod +x "$OUT_DIR/module/service.sh" "$BIN_DIR/ntfy-bridged"
chmod +x "$OUT_DIR/module/customize.sh"

echo "=== Packaging module ==="
(
  cd "$OUT_DIR/module"
  zip -qr "../$(basename "$MODULE_OUT")" .
)

echo "Created: $MODULE_OUT"
