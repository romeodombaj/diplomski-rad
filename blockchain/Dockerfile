# A local Ethereum node with the three contracts already deployed.
#
# This stands in for Sepolia so the whole stack can be brought up offline. It is
# NOT a substitute for a testnet deployment: the chain is wiped on every restart
# and every role sits on hardhat's publicly known account #0.
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# --legacy-peer-deps: hardhat-toolbox@5 pins @types/chai@^4 while the lock
# resolves @types/chai@5, so strict peer resolution refuses the tree that this
# project has always installed and tested against. Fails locally the same way
# without the flag.
RUN npm ci --legacy-peer-deps

COPY hardhat.config.js ./
COPY contracts ./contracts
COPY scripts ./scripts
COPY test ./test

# Compile at build time so container start is just "boot and deploy".
RUN npx hardhat compile

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8545

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD test -f /app/deployments/localhost.json && \
      curl -fsS -X POST -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        http://127.0.0.1:8545 >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
