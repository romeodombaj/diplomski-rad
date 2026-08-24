/**
 * Smoke test against a RUNNING node (not the in-process test EVM).
 * Walks the complete access flow from the spec, printing each step.
 *
 *   npx hardhat node                                   # terminal 1
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/demo.js   --network localhost
 */
const fs = require("fs");
const path = require("path");
const { network, ethers } = require("hardhat");

async function main() {
  const manifestPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`no deployment for '${network.name}' -- run scripts/deploy.js first`);
  }
  const { contracts } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const registry = await ethers.getContractAt("DIDRegistry", contracts.DIDRegistry);
  const policy = await ethers.getContractAt("AccessPolicy", contracts.AccessPolicy);
  const audit = await ethers.getContractAt("AuditLog", contracts.AuditLog);

  const DOOR = "MAIN-01";
  const phone = ethers.Wallet.createRandom();
  const did = `did:demo:${phone.address.slice(2, 34).toLowerCase()}`;

  console.log(`\nphone DID : ${did}`);

  console.log("\n1. enroll: register the phone's public key on-chain");
  await (await registry.registerDID(did, phone.signingKey.publicKey)).wait();
  console.log(`   registered=${await registry.isRegistered(did)}`);

  console.log("\n2. admin grants access to", DOOR);
  const rc = await (await policy.grantAccess(did, DOOR, 0, 0)).wait();
  const policyId = rc.logs
    .map((l) => policy.interface.parseLog(l))
    .find((p) => p && p.name === "AccessGranted").args.policyId;
  console.log(`   policyId=${policyId}`);

  console.log("\n3. phone signs an access request");
  const message = `${did}|${DOOR}|${Math.floor(Date.now() / 1000)}`;
  const signature = await phone.signMessage(message);

  console.log("\n4. backend verifies signature against the ON-CHAIN key");
  const onChainKey = await registry.getPublicKey(did);
  const expected = ethers.computeAddress(onChainKey);
  const recovered = ethers.verifyMessage(message, signature);
  console.log(`   expected=${expected}`);
  console.log(`   recovered=${recovered}`);
  console.log(`   signature valid=${expected === recovered}`);

  console.log("\n5. authorization checks");
  console.log(`   hasAccess=${await policy.hasAccess(did, DOOR)}`);
  console.log(`   isRevoked=${await audit.isRevoked(did)}`);

  console.log("\n6. log the event HASH only (no personal data on-chain)");
  const eventHash = ethers.keccak256(ethers.toUtf8Bytes(message));
  await (await audit.logEvent(eventHash, DOOR)).wait();
  console.log(`   eventHash=${eventHash}`);
  console.log(`   total events=${await audit.getEventCount()}`);

  console.log("\n7. admin revokes the DID (one click on the dashboard)");
  await (await audit.revokeDID(did)).wait();
  console.log(`   isRevoked=${await audit.isRevoked(did)}  -> backend now denies access`);

  console.log("\n8. tamper check: the log is append-only");
  const hasDelete = audit.interface.fragments
    .filter((f) => f.type === "function")
    .some((f) => /delete|remove|clear|edit/i.test(f.name));
  console.log(`   any delete/edit function on AuditLog? ${hasDelete}`);

  console.log("\nOK\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
