import compression from 'compression';
import cookieParser from 'cookie-parser'
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/conifg';
import path from 'path';
import { loggerMiddleware } from './middleware/logger';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';
import healthRoutes from './api/health/health.routes';
import { rateLimiter, v1RateLimiter, authRateLimiter, mobileRateLimiter } from './middleware/rateLimiter';
import authRoutes from './api/auth/auth.routes';
import doorRoutes from './api/door/door.routes';
import deviceRoutes from './api/device/device.routes';
import personRoutes from './api/person/person.routes';
import totp_secretRoutes from './api/totp_secret/totp_secret.routes';
import accessEventRoutes from './api/access_event/access_event.routes';
import policyRoutes from './api/policy/policy.routes';
import mobileRoutes from './api/mobile';
// gt:imports

const app = express();

app.use(helmet());
app.use(compression());
app.use(['/api', '/auth'], cors({
    origin: config.env === 'production' ? false : ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
}));
app.use(['/v1', '/oauth'], cors({ origin: '*', credentials: false }));
app.use('/mobile', cors({ origin: '*', credentials: false }));
app.use(express.json())
app.use(cookieParser());
app.use(loggerMiddleware);
// gt:middleware
app.use('/api', rateLimiter);
app.use('/v1', v1RateLimiter);
// /mobile is unauthenticated by design, so it needs its own IP-keyed limit.
app.use('/mobile', mobileRateLimiter);
app.use('/auth/login', authRateLimiter);
app.use('/auth/register', authRateLimiter);

app.use('/auth', authRoutes)

app.use('/api/health', healthRoutes);
app.use('/api/doors', doorRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/people', personRoutes);
app.use('/api/totp_secrets', totp_secretRoutes);
// The dashboard's audit page has always called /api/audit-logs; until now
// nothing was mounted there. Backed by access_events.
app.use('/api/audit-logs', accessEventRoutes);
app.use('/api/policies', policyRoutes);
app.use('/mobile', mobileRoutes);
// gt:routes

// gt:v1-routes

// gt:static

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
