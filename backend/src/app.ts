import compression from 'compression';
import cookieParser from 'cookie-parser'
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/conifg';
import path from 'path';
import { loggerMiddleware } from './middleware/logger';
import { tenantMiddleware } from './middleware/tenant';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';
import healthRoutes from './api/health/health.routes';
import { rateLimiter, v1RateLimiter, authRateLimiter } from './middleware/rateLimiter';
import authRoutes from './api/auth/auth.routes';
import buildingRoutes from './api/building/building.routes';
import doorRoutes from './api/door/door.routes';
import totp_secretRoutes from './api/totp_secret/totp_secret.routes';
import verifyRoutes from './api/verify/verify.routes';
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
app.use('/auth/login', authRateLimiter);
app.use('/auth/register', authRateLimiter);

app.use('/auth', authRoutes)
app.use('/api', tenantMiddleware);

app.use('/api/health', healthRoutes);
app.use('/api/buildings', buildingRoutes);
app.use('/api/doors', doorRoutes);
app.use('/api/totp_secrets', totp_secretRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/mobile', mobileRoutes);
// gt:routes

// gt:v1-routes

// gt:static

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
