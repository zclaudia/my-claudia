#!/system/bin/sh
MODPATH=${0%/*}

chmod 0755 "$MODPATH/service.sh"
chmod 0755 "$MODPATH/bin"
chmod 0755 "$MODPATH/bin/ntfy-bridged"
mkdir -p "$MODPATH/certs"
chmod 0755 "$MODPATH/certs"
chmod 0644 "$MODPATH/certs/cacert.pem"
