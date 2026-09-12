#!/bin/sh
# Materialise keypairs from Fly secrets (the apps read *_KEYPAIR_PATH files).
#   fly secrets set KEEPER_KEYPAIR_JSON="$(cat keys/keeper.json)"
set -e
if [ -n "$KEEPER_KEYPAIR_JSON" ]; then
  printf '%s' "$KEEPER_KEYPAIR_JSON" > /app/keys/keeper.json
  export KEEPER_KEYPAIR_PATH=/app/keys/keeper.json
fi
if [ -n "$ADMIN_KEYPAIR_JSON" ]; then
  printf '%s' "$ADMIN_KEYPAIR_JSON" > /app/keys/admin.json
  export ADMIN_KEYPAIR_PATH=/app/keys/admin.json
fi
exec "$@"
