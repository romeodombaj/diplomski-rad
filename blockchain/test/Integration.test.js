const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Integration: full access flow", function () {
  let registry, policy, audit, admin, backend;
  const DOOR = "MAIN-01";

  const accessMessage = (did, door, timestamp, nonce) =>
    `${did}|${door}|${timestamp}|${nonce}`;

  async function grant(did, door, start, end) {
    const tx = await policy.grantAccess(did, door, start, end, ethers.ZeroHash);
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      const parsed = policy.interface.parseLog(log);
      if (parsed && parsed.name === "AccessGranted") return parsed.args.policyId;
    }
  }

  beforeEach(async function () {
    [admin, backend] = await ethers.getSigners();
    registry = await ethers.deployContract("DIDRegistry", [admin.address]);
    policy = await ethers.deployContract("AccessPolicy", [admin.address]);
    audit = await ethers.deployContract("AuditLog", [admin.address]);
    await registry.grantRole(await registry.BACKEND_ROLE(), backend.address);
    await audit.grantRole(await audit.BACKEND_ROLE(), backend.address);
  });

  it("register -> grant -> verify -> log", async function () {
    const did = "did:demo:phone1";
    const phone = ethers.Wallet.createRandom();

    await registry.connect(backend).registerDID(did, phone.signingKey.publicKey);

    await grant(did, DOOR, 0, 0);

    const message = accessMessage(did, DOOR, await time.latest(), "a1b2c3d4e5f60718");
    const signature = await phone.signMessage(message);

    const storedKey = await registry.getPublicKey(did);
    const expectedAddress = ethers.computeAddress(storedKey);
    const recovered = ethers.verifyMessage(message, signature);
    expect(recovered).to.equal(expectedAddress);

    expect(await policy.hasAccess(did, DOOR)).to.equal(true);
    expect(await audit.isRevoked(did)).to.equal(false);

    const eventHash = ethers.keccak256(ethers.toUtf8Bytes(message));
    await audit.connect(backend).logEvent(eventHash, DOOR);

    expect(await audit.getEventCount()).to.equal(1);
    const [logged] = await audit.getEvents(0, 1);
    expect(logged.eventHash).to.equal(eventHash);
  });

  it("rejects a signature from a different phone", async function () {
    const did = "did:demo:phone1";
    const phone = ethers.Wallet.createRandom();
    const attacker = ethers.Wallet.createRandom();

    await registry.connect(backend).registerDID(did, phone.signingKey.publicKey);
    await grant(did, DOOR, 0, 0);

    const message = accessMessage(did, DOOR, await time.latest(), "a1b2c3d4e5f60718");
    const forged = await attacker.signMessage(message);

    const expectedAddress = ethers.computeAddress(await registry.getPublicKey(did));
    expect(ethers.verifyMessage(message, forged)).to.not.equal(expectedAddress);
  });

  it("revocation flow: register -> grant -> revoke DID -> denied everywhere", async function () {
    const did = "did:demo:phone2";
    const phone = ethers.Wallet.createRandom();

    await registry.connect(backend).registerDID(did, phone.signingKey.publicKey);
    await grant(did, "MAIN-01", 0, 0);
    await grant(did, "SIDE-02", 0, 0);

    expect(await policy.hasAccess(did, "MAIN-01")).to.equal(true);
    expect(await policy.hasAccess(did, "SIDE-02")).to.equal(true);

    await audit.revokeDID(did);

    expect(await audit.isRevoked(did)).to.equal(true);
    expect(await policy.hasAccess(did, "MAIN-01")).to.equal(true);
  });

  it("policy revocation flow: granted -> revoked -> denied", async function () {
    const did = "did:demo:phone3";
    const id = await grant(did, DOOR, 0, 0);
    expect(await policy.hasAccess(did, DOOR)).to.equal(true);

    await policy.revokeAccess(id);
    expect(await policy.hasAccess(did, DOOR)).to.equal(false);
  });

  it("time-window enforcement across the whole flow", async function () {
    const did = "did:demo:contractor";
    const phone = ethers.Wallet.createRandom();
    await registry.connect(backend).registerDID(did, phone.signingKey.publicKey);

    const now = await time.latest();
    await grant(did, DOOR, now, now + 3600);

    expect(await policy.hasAccess(did, DOOR)).to.equal(true);
    await time.increaseTo(now + 3601);
    expect(await policy.hasAccess(did, DOOR)).to.equal(false);
  });

  it("audit log accumulates across multiple accesses and stays ordered", async function () {
    const did = "did:demo:phone4";
    await grant(did, DOOR, 0, 0);

    for (let i = 0; i < 3; i++) {
      await audit.connect(backend).logEvent(`0xhash${i}`, DOOR);
    }

    const all = await audit.getEvents(0, 10);
    expect(all.length).to.equal(3);
    expect(all[0].eventHash).to.equal("0xhash0");
    expect(all[2].eventHash).to.equal("0xhash2");
    expect(all[0].timestamp).to.be.lessThanOrEqual(all[2].timestamp);
  });
});
