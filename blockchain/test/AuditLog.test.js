const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuditLog", function () {
  let audit, admin, backend, outsider;
  const HASH = "0xfeedface";
  const DOOR = "MAIN-01";
  const DID = "did:demo:a1b2c3";

  beforeEach(async function () {
    [admin, backend, outsider] = await ethers.getSigners();
    audit = await ethers.deployContract("AuditLog", [admin.address]);
    await audit.grantRole(await audit.BACKEND_ROLE(), backend.address);
  });

  // ── event log ─────────────────────────────────────────────────────────

  it("appends an event and counts it", async function () {
    await audit.connect(backend).logEvent(HASH, DOOR);
    expect(await audit.getEventCount()).to.equal(1);

    const [e] = await audit.getEvents(0, 1);
    expect(e.eventHash).to.equal(HASH);
    expect(e.doorCode).to.equal(DOOR);
    expect(e.timestamp).to.be.greaterThan(0);
  });

  it("emits EventLogged with its index", async function () {
    await expect(audit.connect(backend).logEvent(HASH, DOOR))
      .to.emit(audit, "EventLogged");
  });

  it("pages through events", async function () {
    for (let i = 0; i < 5; i++) {
      await audit.connect(backend).logEvent(`0xhash${i}`, DOOR);
    }
    expect((await audit.getEvents(0, 2)).length).to.equal(2);
    expect((await audit.getEvents(3, 10)).length).to.equal(2);
    expect((await audit.getEvents(99, 5)).length).to.equal(0);
  });

  it("rejects empty hash or door", async function () {
    await expect(audit.connect(backend).logEvent("", DOOR))
      .to.be.revertedWithCustomError(audit, "EmptyField");
    await expect(audit.connect(backend).logEvent(HASH, ""))
      .to.be.revertedWithCustomError(audit, "EmptyField");
  });

  // AUDIT.md F-23
  it("blocks logging from an address without BACKEND_ROLE", async function () {
    await expect(audit.connect(outsider).logEvent(HASH, DOOR))
      .to.be.revertedWithCustomError(audit, "AccessControlUnauthorizedAccount");
  });

  // ── revocation list ───────────────────────────────────────────────────

  it("revokes and restores a DID", async function () {
    expect(await audit.isRevoked(DID)).to.equal(false);

    await audit.revokeDID(DID);
    expect(await audit.isRevoked(DID)).to.equal(true);
    expect(await audit.getRevokedCount()).to.equal(1);

    await audit.restoreDID(DID);
    expect(await audit.isRevoked(DID)).to.equal(false);
    expect(await audit.getRevokedCount()).to.equal(0);
  });

  it("cannot revoke twice or restore a DID that is not revoked", async function () {
    await audit.revokeDID(DID);
    await expect(audit.revokeDID(DID)).to.be.revertedWithCustomError(audit, "AlreadyRevoked");
    await audit.restoreDID(DID);
    await expect(audit.restoreDID(DID)).to.be.revertedWithCustomError(audit, "NotRevoked");
  });

  // restoreDID uses swap-and-pop, which is where an off-by-one would hide:
  // removing from the middle moves the last element into the freed slot, and
  // its stored index must be updated or a later restore corrupts the list.
  it("keeps the list consistent when restoring from the middle", async function () {
    await audit.revokeDID("did:a");
    await audit.revokeDID("did:b");
    await audit.revokeDID("did:c");
    expect(await audit.getRevokedCount()).to.equal(3);

    await audit.restoreDID("did:b");
    expect(await audit.getRevokedCount()).to.equal(2);
    expect(await audit.isRevoked("did:a")).to.equal(true);
    expect(await audit.isRevoked("did:b")).to.equal(false);
    expect(await audit.isRevoked("did:c")).to.equal(true);

    // "did:c" was swapped into b's slot -- restoring it must still work.
    await audit.restoreDID("did:c");
    expect(await audit.getRevokedCount()).to.equal(1);
    expect(await audit.isRevoked("did:a")).to.equal(true);
    expect(await audit.isRevoked("did:c")).to.equal(false);

    const list = await audit.getRevokedList(0, 10);
    expect(list).to.deep.equal(["did:a"]);
  });

  it("re-revoking after a restore works", async function () {
    await audit.revokeDID(DID);
    await audit.restoreDID(DID);
    await audit.revokeDID(DID);
    expect(await audit.isRevoked(DID)).to.equal(true);
    expect(await audit.getRevokedList(0, 10)).to.deep.equal([DID]);
  });

  it("blocks revocation from an address without REVOCATION_ADMIN_ROLE", async function () {
    await expect(audit.connect(outsider).revokeDID(DID))
      .to.be.revertedWithCustomError(audit, "AccessControlUnauthorizedAccount");
  });

  it("has no function that deletes or edits a logged event", async function () {
    const names = audit.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name.toLowerCase());
    const mutators = names.filter(
      (n) => n.includes("delete") || n.includes("remove") || n.includes("edit") || n.includes("clear")
    );
    expect(mutators).to.deep.equal([]);
  });
});
