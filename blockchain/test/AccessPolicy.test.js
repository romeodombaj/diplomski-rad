const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AccessPolicy", function () {
  let policy, admin, outsider;
  const DID = "did:demo:a1b2c3";
  const DOOR = "MAIN-01";
  // The sentinel for "no recurring schedule" — 24/7 access, nothing for the
  // backend to enforce. See specs/06_access_control.md section 4, option C.
  const NO_SCHEDULE = ethers.ZeroHash;

  // grantAccess returns a value on-chain, but a transaction only yields a
  // receipt off-chain -- so read the id back out of the emitted event.
  async function grant(did, door, start, end, signer = admin, schedule = NO_SCHEDULE) {
    const tx = await policy.connect(signer).grantAccess(did, door, start, end, schedule);
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
    await expect(policy.grantAccess(DID, DOOR, now + 100, now + 50, NO_SCHEDULE))
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
    await expect(policy.connect(outsider).grantAccess(DID, DOOR, 0, 0, NO_SCHEDULE))
      .to.be.revertedWithCustomError(policy, "AccessControlUnauthorizedAccount");
  });

  it("blocks revoking from an address without POLICY_ADMIN_ROLE", async function () {
    const id = await grant(DID, DOOR, 0, 0);
    await expect(policy.connect(outsider).revokeAccess(id))
      .to.be.revertedWithCustomError(policy, "AccessControlUnauthorizedAccount");
  });

  it("stores the schedule commitment and reports it back", async function () {
    // The chain cannot express "Mon-Fri 09:00-17:00"; it commits to a hash of
    // the schedule so the backend that enforces it cannot silently widen it.
    const schedule = ethers.keccak256(
      ethers.toUtf8Bytes("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR|540|1020|Europe/Zagreb"),
    );
    const id = await grant(DID, DOOR, 0, 0, admin, schedule);

    const stored = await policy.getPolicy(id);
    expect(stored.scheduleHash).to.equal(schedule);

    const [allowed, reported] = await policy.hasAccessWithSchedule(DID, DOOR);
    expect(allowed).to.equal(true);
    expect(reported).to.equal(schedule);
  });

  it("reports a zero commitment for unscheduled access", async function () {
    await grant(DID, DOOR, 0, 0);
    const [allowed, schedule] = await policy.hasAccessWithSchedule(DID, DOOR);
    expect(allowed).to.equal(true);
    expect(schedule).to.equal(NO_SCHEDULE);
  });

  it("prefers a 24/7 policy over a scheduled one", async function () {
    // Two grants for the same door, one scheduled and one not. The unscheduled
    // one is the weaker constraint, so the backend must be told there is no
    // window to enforce rather than being handed an arbitrary one.
    const schedule = ethers.keccak256(ethers.toUtf8Bytes("weekdays"));
    await grant(DID, DOOR, 0, 0, admin, schedule);
    await grant(DID, DOOR, 0, 0);

    const [allowed, reported] = await policy.hasAccessWithSchedule(DID, DOOR);
    expect(allowed).to.equal(true);
    expect(reported).to.equal(NO_SCHEDULE);
  });

  it("reports no access with a zero commitment when nothing matches", async function () {
    const [allowed, schedule] = await policy.hasAccessWithSchedule(DID, "NOPE-99");
    expect(allowed).to.equal(false);
    expect(schedule).to.equal(NO_SCHEDULE);
  });

  it("does not report a revoked policy's schedule", async function () {
    const schedule = ethers.keccak256(ethers.toUtf8Bytes("weekdays"));
    const id = await grant(DID, DOOR, 0, 0, admin, schedule);
    await policy.revokeAccess(id);
    const [allowed] = await policy.hasAccessWithSchedule(DID, DOOR);
    expect(allowed).to.equal(false);
  });

  it("rejects empty did or door", async function () {
    await expect(policy.grantAccess("", DOOR, 0, 0, NO_SCHEDULE))
      .to.be.revertedWithCustomError(policy, "EmptyField");
    await expect(policy.grantAccess(DID, "", 0, 0, NO_SCHEDULE))
      .to.be.revertedWithCustomError(policy, "EmptyField");
  });
});
