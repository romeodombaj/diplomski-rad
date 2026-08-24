const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AccessPolicy", function () {
  let policy, admin, outsider;
  const DID = "did:demo:a1b2c3";
  const DOOR = "MAIN-01";

  // grantAccess returns a value on-chain, but a transaction only yields a
  // receipt off-chain -- so read the id back out of the emitted event.
  async function grant(did, door, start, end, signer = admin) {
    const tx = await policy.connect(signer).grantAccess(did, door, start, end);
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      const parsed = policy.interface.parseLog(log);
      if (parsed && parsed.name === "AccessGranted") return parsed.args.policyId;
    }
    throw new Error("AccessGranted not emitted");
  }

  beforeEach(async function () {
    [admin, outsider] = await ethers.getSigners();
    policy = await ethers.deployContract("AccessPolicy", [admin.address]);
  });

  it("grants access and reports it", async function () {
    await grant(DID, DOOR, 0, 0);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(true);
    expect(await policy.getPolicyCount()).to.equal(1);
  });

  it("denies a DID with no policy", async function () {
    expect(await policy.hasAccess("did:demo:stranger", DOOR)).to.equal(false);
  });

  it("denies a door the DID was not granted", async function () {
    await grant(DID, DOOR, 0, 0);
    expect(await policy.hasAccess(DID, "SERVER-ROOM")).to.equal(false);
  });

  it("revoking a policy denies access but keeps it readable for auditors", async function () {
    const id = await grant(DID, DOOR, 0, 0);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(true);

    await policy.revokeAccess(id);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(false);

    const p = await policy.getPolicy(id);
    expect(p.active).to.equal(false);
    expect(p.did).to.equal(DID);
  });

  it("cannot revoke the same policy twice", async function () {
    const id = await grant(DID, DOOR, 0, 0);
    await policy.revokeAccess(id);
    await expect(policy.revokeAccess(id))
      .to.be.revertedWithCustomError(policy, "PolicyAlreadyRevoked");
  });

  it("reverts revoking an unknown policy", async function () {
    await expect(policy.revokeAccess("pol-999"))
      .to.be.revertedWithCustomError(policy, "PolicyNotFound");
  });

  // ── time windows ──────────────────────────────────────────────────────

  it("denies access before the window opens", async function () {
    const now = await time.latest();
    await grant(DID, DOOR, now + 3600, now + 7200);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(false);
  });

  it("allows access inside the window", async function () {
    const now = await time.latest();
    await grant(DID, DOOR, now - 10, now + 3600);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(true);
  });

  it("denies access after the window closes", async function () {
    const now = await time.latest();
    await grant(DID, DOOR, now, now + 3600);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(true);

    await time.increaseTo(now + 7200);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(false);
  });

  it("treats endTime 0 as never expiring", async function () {
    const now = await time.latest();
    await grant(DID, DOOR, now - 10, 0);
    await time.increaseTo(now + 365 * 24 * 3600);
    expect(await policy.hasAccess(DID, DOOR)).to.equal(true);
  });

  it("rejects a window that ends before it starts", async function () {
    const now = await time.latest();
    await expect(policy.grantAccess(DID, DOOR, now + 100, now + 50))
      .to.be.revertedWithCustomError(policy, "InvalidTimeWindow");
  });

  // ── lookups and authorization ─────────────────────────────────────────

  it("lists policies by DID and by door", async function () {
    await grant(DID, DOOR, 0, 0);
    await grant(DID, "SIDE-02", 0, 0);
    await grant("did:demo:other", DOOR, 0, 0);

    expect((await policy.getPoliciesForDID(DID)).length).to.equal(2);
    expect((await policy.getPoliciesForDoor(DOOR)).length).to.equal(2);
  });

  it("still grants when one of several policies matches", async function () {
    const now = await time.latest();
    await grant(DID, DOOR, now + 9999, now + 99999); // not yet valid
    await grant(DID, DOOR, now - 10, 0);             // valid now
    expect(await policy.hasAccess(DID, DOOR)).to.equal(true);
  });

  // AUDIT.md F-23
  it("blocks granting from an address without POLICY_ADMIN_ROLE", async function () {
    await expect(policy.connect(outsider).grantAccess(DID, DOOR, 0, 0))
      .to.be.revertedWithCustomError(policy, "AccessControlUnauthorizedAccount");
  });

  it("blocks revoking from an address without POLICY_ADMIN_ROLE", async function () {
    const id = await grant(DID, DOOR, 0, 0);
    await expect(policy.connect(outsider).revokeAccess(id))
      .to.be.revertedWithCustomError(policy, "AccessControlUnauthorizedAccount");
  });

  it("rejects empty did or door", async function () {
    await expect(policy.grantAccess("", DOOR, 0, 0))
      .to.be.revertedWithCustomError(policy, "EmptyField");
    await expect(policy.grantAccess(DID, "", 0, 0))
      .to.be.revertedWithCustomError(policy, "EmptyField");
  });
});
