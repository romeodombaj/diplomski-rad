import type { NextFunction, Request, Response } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const e of result.error.errors) {
        const key = e.path.join('.') || '_';
        if (!fields[key]) fields[key] = e.message;
      }
      const message = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(', ');
      return res.status(400).json({ success: false, message, fields });
    }
    req.body = result.data;
    next();
  };
}
