#!/system/bin/sh
MODDIR=${0%/*}
DATADIR=/data/local/ntfy-bridge
BINARY="$DATADIR/ntfy-bridged"
CACERT="$DATADIR/cacert.pem"

mkdir -p "$DATADIR"

while [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 5
done
sleep 10

cp "$MODDIR/bin/ntfy-bridged" "$BINARY"
cp "$MODDIR/certs/cacert.pem" "$CACERT"
chmod 0755 "$BINARY"
chmod 0644 "$CACERT"

export SSL_CERT_FILE="$CACERT"

nohup "$BINARY" \
  -listen 127.0.0.1:9595 \
  -data "$DATADIR" \
  > "$DATADIR/daemon.log" 2>&1 &
