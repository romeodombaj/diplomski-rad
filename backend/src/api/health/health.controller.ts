import type { Request, Response } from 'express'
import * as response from '../../utils/response'
import * as chain from '../../services/chainService'
import * as mqttService from '../../services/mqttService'
import { config } from '../../config/conifg'

export const getHealth = (_req: Request, res: Response) => {
  response.ok(res, { status: 'ok' })
}

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
