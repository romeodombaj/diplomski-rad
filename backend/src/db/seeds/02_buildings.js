const fs = require('fs')
const path = require('path')

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

exports.seed = async function (knex) {
  const existing = await knex('buildings').where({ name: 'Default' }).first()
  if (existing) return

  const contractAddress = deployedPolicyAddress()

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
