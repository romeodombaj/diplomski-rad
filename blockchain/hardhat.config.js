require("@nomicfoundation/hardhat-toolbox");

/**
 * Networks are deliberately limited to `hardhat` (in-process, for tests) and
 * `localhost` (the `npx hardhat node` chain running on this machine).
 *
 * `sepolia` only appears when SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY are set,
 * so a stray `--network sepolia` fails loudly instead of half-working.
 *
 * Ethereum MAINNET is intentionally absent. Gas there is paid in real ETH;
 * there is no reason for this project to ever touch it.
 */
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      // OpenZeppelin v5 uses the mcopy opcode, which needs Cancun. Sepolia has
      // supported it since the Dencun upgrade, so this is safe for our targets.
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            accounts: [DEPLOYER_PRIVATE_KEY],
            chainId: 11155111,
          },
        }
      : {}),
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
