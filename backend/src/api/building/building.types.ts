export interface Building {
  id: number;
  name: string;
  address: string;
  contract_address: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBuildingDto {
  name: string;
  address: string;
  contract_address: string;
}

export interface UpdateBuildingDto {
  name?: string;
  address?: string;
  contract_address?: string;
}

export interface BuildingSearchParams {
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

export interface BuildingCursorPage {
  data: Building[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}
