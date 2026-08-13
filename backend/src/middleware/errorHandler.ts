import type { NextFunction, Request, Response } from "express";
import logger from "../lib/logger";

export class AppError extends Error {
    constructor(
        public readonly message: string,
        public readonly statusCode: number = 500
    ) {
        super(message);
        this.name = "AppError";
        Error.captureStackTrace(this, this.constructor);
    }
}

export function errorHandler(
    err: Error | AppError,
    req: Request,
    res: Response,
    _next: NextFunction
) {
    const statusCode =
        err instanceof AppError ? err.statusCode : (err as any).status ?? 500;
    const message =
        statusCode < 500 || err instanceof AppError
            ? err.message
            : "Internal Server Error";

    if (statusCode >= 500) {
        logger.error(
            { err, method: req.method, url: req.originalUrl },
            message
        );
    }

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === "development" &&
            statusCode >= 500 && { stack: err.stack }),
    });
}
