const fs = require('fs')
const path = require('path')

/**
 * `contract_address` was the literal string 'TBD' on every seeded row, so no
 * building had ever pointed at a deployed contract. It now picks up the
 * AccessPolicy address from the deployment manifest `blockchain/scripts/
 * deploy.js` writes, falling back to 'TBD' when nothing is deployed yet.
 *
 * The manifest holds three addresses and this column holds one (AUDIT.md F-13);
 * the backend resolves all three through chainService, so this value is the
 * per-building marker of *which* deployment a building belongs to rather than
 * the backend's only source of addresses.
 */
function deployedPolicyAddress() {
  const network = process.env.CHAIN_NETWORK || 'localhost'
  const file =
    process.env.CHAIN_DEPLOYMENT_FILE ||
    path.resolve(process.cwd(), '..', 'blockchain', 'deployments', `${network}.json`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.contracts?.AccessPolicy || 'TBD'
  } catch {
    return 'TBD'
  }
}

/** @param {import('knex').Knex} knex */
exports.seed = async function (knex) {
  const existing = await knex('buildings').where({ name: 'Default' }).first()
  if (existing) return

  const contractAddress = deployedPolicyAddress()

  // insert sandbox first (live references it)
  const [sandboxId] = await knex('buildings').insert({
    name: 'Default',
    address: 'TBD',
    contract_address: contractAddress,
    is_sandbox: true,
  })
  await knex('buildings').insert({
    name: 'Default',
    address: 'TBD',
    contract_address: contractAddress,
    is_sandbox: false,
    sandbox_building_id: sandboxId,
  })

  console.log(
    `Seeded default building (live + sandbox), contract_address=${contractAddress}` +
      (contractAddress === 'TBD' ? ' — deploy the contracts and re-seed to bind it' : ''),
  )
}
