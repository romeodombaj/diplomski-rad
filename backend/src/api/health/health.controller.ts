import type { Request, Response } from 'express'
import * as response from '../../utils/response'

export const getHealth = (_req: Request, res: Response) => {
  response.ok(res, { status: 'ok' })
}
