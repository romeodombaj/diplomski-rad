import type { Request, Response } from 'express'
import * as response from '../../utils/response'
import * as chain from '../../services/chainService'
import * as mqttService from '../../services/mqttService'
import { config } from '../../config/conifg'

/**
 * Public liveness probe. Deliberately says nothing else: whether the biometric
 * factor is enforced, at what threshold, whether the chain is authoritative,
 * and which contracts and signer address this backend uses are all useful to
 * someone deciding how to attack it. Load balancers only need the heartbeat.
 */
export const getHealth = (_req: Request, res: Response) => {
  response.ok(res, { status: 'ok' })
}

/**
 * Operator-facing detail. Both optional subsystems fail soft at startup, so
 * without this there is no way to tell a backend that is writing to Sepolia
 * from one that silently is not.
 */
export const getStatus = (_req: Request, res: Response) => {
  response.ok(res, {
    status: 'ok',
    chain: chain.status(),
    mqtt: mqttService.status(),
    access: {
      requireChain: config.chain.requireChain,
      requireFace: config.access.requireFace,
      faceThreshold: config.access.faceThreshold,
    },
  })
}
