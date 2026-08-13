declare namespace Express {
  interface Request {
    id: string;
    auditDescription?: string | null;
    user: {
      tenantId: string;
      projectId?: string;
      isSandbox?: boolean;
      userId?: string;
      email?: string;
      role?: string;
    }
  }
}
