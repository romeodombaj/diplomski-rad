/**
 * Deploys DIDRegistry, AccessPolicy and AuditLog, then writes their addresses
 * to deployments/<network>.json.
 *
 * AUDIT.md F-13: the backend's `building.contract_address` is a single string
 * and cannot hold three addresses. This file is the resolution -- the backend
 * loads one deployment manifest per network and looks up each contract by
 * name, rather than trying to pack three addresses into one column.
 *
 *   npx hardhat run scripts/deploy.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const { network, ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`\nnetwork : ${network.name}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`balance : ${ethers.formatEther(balance)} ETH\n`);

  const registry = await ethers.deployContract("DIDRegistry", [deployer.address]);
  await registry.waitForDeployment();
  console.log(`DIDRegistry  ${await registry.getAddress()}`);

  const policy = await ethers.deployContract("AccessPolicy", [deployer.address]);
  await policy.waitForDeployment();
  console.log(`AccessPolicy ${await policy.getAddress()}`);

  const audit = await ethers.deployContract("AuditLog", [deployer.address]);
  await audit.waitForDeployment();
  console.log(`AuditLog     ${await audit.getAddress()}`);

  const manifest = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      DIDRegistry: await registry.getAddress(),
      AccessPolicy: await policy.getAddress(),
      AuditLog: await audit.getAddress(),
    },
    roles: {
      // The deployer holds every role after deployment. In a real multi-building
      // setup each backend gets its own address granted BACKEND_ROLE, so a
      // compromised backend can be cut off without redeploying anything.
      BACKEND_ROLE: ethers.id("BACKEND_ROLE"),
      POLICY_ADMIN_ROLE: ethers.id("POLICY_ADMIN_ROLE"),
      REVOCATION_ADMIN_ROLE: ethers.id("REVOCATION_ADMIN_ROLE"),
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\nmanifest -> deployments/${network.name}.json\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
