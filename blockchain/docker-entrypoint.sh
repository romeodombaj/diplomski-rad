#!/bin/sh
set -eu

npx hardhat node --hostname 0.0.0.0 --port 8545 &
NODE_PID=$!

echo "[chain] waiting for the node to accept connections..."
i=0
until curl -fsS -X POST -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        http://127.0.0.1:8545 >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[chain] node did not come up in 60s" >&2
    exit 1
  fi
  sleep 1
done

echo "[chain] deploying contracts..."
rm -f /app/deployments/localhost.json
npx hardhat run scripts/deploy.js --network localhost

echo "[chain] ready. manifest:"
cat /app/deployments/localhost.json

wait "$NODE_PID"
