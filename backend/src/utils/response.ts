import type { Response } from 'express'

export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data })

export const created = (res: Response, data: unknown) => ok(res, data, 201)

export const error = (res: Response, message: string, status = 500) =>
  res.status(status).json({ success: false, message })

export const notFound = (res: Response, message = 'Not found') => error(res, message, 404)

export const badRequest = (res: Response, message = 'Bad request') => error(res, message, 400)

export const jsonParseNull = <T = unknown>(value: string): T | null => {
  try { return JSON.parse(value) as T; } catch { return null; }
}

export const jsonParse = <T = unknown>(value: string): T | string => {
  try { return JSON.parse(value) as T; } catch { return ''; }
}
