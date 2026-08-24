const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DIDRegistry", function () {
  let registry, admin, backend, outsider;
  const DID = "did:demo:a1b2c3";
  const PUBKEY = "0x04bfcab3";

  beforeEach(async function () {
    [admin, backend, outsider] = await ethers.getSigners();
    registry = await ethers.deployContract("DIDRegistry", [admin.address]);
    await registry.grantRole(await registry.BACKEND_ROLE(), backend.address);
  });

  it("registers a DID and stores its public key", async function () {
    await registry.connect(backend).registerDID(DID, PUBKEY);
    expect(await registry.getPublicKey(DID)).to.equal(PUBKEY);
    expect(await registry.isRegistered(DID)).to.equal(true);
    expect(await registry.getRegisteredDIDCount()).to.equal(1);
  });

  it("records a registration timestamp", async function () {
    await registry.connect(backend).registerDID(DID, PUBKEY);
    expect(await registry.getRegistrationTime(DID)).to.be.greaterThan(0);
  });

  it("emits DIDRegistered", async function () {
    await expect(registry.connect(backend).registerDID(DID, PUBKEY))
      .to.emit(registry, "DIDRegistered");
  });

  it("reports unregistered DIDs as not registered", async function () {
    expect(await registry.isRegistered("did:demo:nope")).to.equal(false);
  });

  it("reverts when reading a key for an unregistered DID", async function () {
    await expect(registry.getPublicKey("did:demo:nope"))
      .to.be.revertedWithCustomError(registry, "DIDNotRegistered");
  });

  // The security property: a compromised backend must not be able to silently
  // point an existing identity at a key it controls.
  it("refuses to overwrite an existing DID", async function () {
    await registry.connect(backend).registerDID(DID, PUBKEY);
    await expect(registry.connect(backend).registerDID(DID, "0xdeadbeef"))
      .to.be.revertedWithCustomError(registry, "DIDAlreadyRegistered");
  });

  it("rejects empty DID and empty public key", async function () {
    await expect(registry.connect(backend).registerDID("", PUBKEY))
      .to.be.revertedWithCustomError(registry, "EmptyDID");
    await expect(registry.connect(backend).registerDID(DID, "0x"))
      .to.be.revertedWithCustomError(registry, "EmptyPublicKey");
  });

  // AUDIT.md F-23: without this, anyone on Sepolia could register DIDs.
  it("blocks registration from an address without BACKEND_ROLE", async function () {
    await expect(registry.connect(outsider).registerDID(DID, PUBKEY))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("pages through registered DIDs", async function () {
    for (let i = 0; i < 5; i++) {
      await registry.connect(backend).registerDID(`did:demo:${i}`, PUBKEY);
    }
    expect(await registry.getRegisteredDIDs(0, 2)).to.deep.equal(["did:demo:0", "did:demo:1"]);
    expect(await registry.getRegisteredDIDs(4, 10)).to.deep.equal(["did:demo:4"]);
    expect(await registry.getRegisteredDIDs(99, 5)).to.deep.equal([]);
  });
});
