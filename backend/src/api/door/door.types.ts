export interface Door {
  id: number;
  building_id: number;
  name: string;
  door_code: string;
  mqtt_topic: string;
  active: boolean;
  locked_down: boolean;
  locked_down_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDoorDto {
  name: string;
  door_code: string;
  mqtt_topic: string;
  active: boolean;
}

export interface UpdateDoorDto {
  name?: string;
  door_code?: string;
  mqtt_topic?: string;
  active?: boolean;
}

export interface DoorSearchParams {
  q?: string;
  cursor?: string;
  limit?: number;
  count?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  active?: string;
  created_at_from?: string;
  created_at_to?: string;
  updated_at_from?: string;
  updated_at_to?: string;
}

export interface DoorCursorPage {
  data: Door[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}
