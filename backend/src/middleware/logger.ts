import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import logger from '../lib/logger';

const isDev = process.env.NODE_ENV !== 'production';

const c = {
  reset: '\x1b[0m',
  gray:  '\x1b[38;5;242m',
  blue:  '\x1b[34m',
  white: '\x1b[97m',
  dim:   '\x1b[38;5;238m',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function clfDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign      = offsetMin >= 0 ? '+' : '-';
  const absMin    = Math.abs(offsetMin);
  const tz        = `${sign}${pad(Math.floor(absMin / 60))}${pad(absMin % 60)}`;
  return `${pad(d.getDate())}/${MONTHS[d.getMonth()]}/${d.getFullYear()}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tz}`;
}

function combinedLine(req: IncomingMessage, res: ServerResponse, responseTime: number): string {
  const ip          = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
                      ?? (req.socket?.remoteAddress ?? '-');
  const date        = clfDate(new Date());
  const method      = req.method ?? '-';
  const url         = (req as any).originalUrl ?? req.url ?? '-';
  const httpVersion = `HTTP/${req.httpVersion}`;
  const status      = res.statusCode;
  const cl          = res.getHeader('content-length') ?? '-';
  const referrer    = (req.headers.referer ?? req.headers.referrer ?? '-') as string;
  const ua          = (req.headers['user-agent'] ?? '-') as string;

  const user        = (req as any).user;
  const tenantId    = user?.tenantId ?? '-';
  const email       = user?.email    ?? '-';
  const reqId       = (req as any).id ?? '-';

  if (!isDev) {
    return `${ip} - - [${date}] "${method} ${url} ${httpVersion}" ${status} ${cl} "${referrer}" "${ua}" ${responseTime}ms [tenant:${tenantId}] [user:${email}] [req:${reqId}]`;
  }

  const g = c.gray;
  const r = c.reset;
  const d = c.dim;

  return (
    `${g}${ip} - - [${date}]${r} ` +
    `${c.blue}"${method} ${url} ${httpVersion}"${r} ` +
    `${c.white}${status}${r} ` +
    `${g}${cl} "${referrer}" "${ua}" ${responseTime}ms${r} ` +
    `${d}[tenant:${tenantId}] [user:${email}] [req:${reqId}]${r}`
  );
}

export const loggerMiddleware = pinoHttp({
  logger,
  genReqId(req) {
    const existing = req.headers['x-request-id'] as string;
    const id = existing || randomUUID();
    (req as any).id = id;
    return id;
  },
  customLogLevel(_req: IncomingMessage, res: ServerResponse) {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage(req: IncomingMessage, res: ServerResponse, responseTime: number) {
    return combinedLine(req, res, responseTime);
  },
  customErrorMessage(req: IncomingMessage, res: ServerResponse, _err: Error) {
    return combinedLine(req, res, 0);
  },
  serializers: {
    req: () => ({}),
    res: () => ({}),
  },
});
