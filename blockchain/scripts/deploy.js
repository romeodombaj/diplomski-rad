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
