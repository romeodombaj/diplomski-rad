export interface Totp_secret {
  id: number;
  did: string;
  secret: string;
  period: number;
  digits: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTotp_secretDto {
  did: string;
  secret: string;
  period: number;
  digits: number;
}

export interface UpdateTotp_secretDto {
  did?: string;
  secret?: string;
  period?: number;
  digits?: number;
}

export interface Totp_secretSearchParams {
  q?: string;
  cursor?: string;
  limit?: number;
  count?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  created_at_from?: string;
  created_at_to?: string;
  updated_at_from?: string;
  updated_at_to?: string;
}

export interface Totp_secretCursorPage {
  data: Totp_secret[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}
