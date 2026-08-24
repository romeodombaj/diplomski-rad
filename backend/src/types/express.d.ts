declare namespace Express {
  interface Request {
    id: string;
    auditDescription?: string | null;
    user: {
      buildingId?: number;
      isSandbox?: boolean;
      userId?: string;
      email?: string;
      role?: string;
    }
  }
}
