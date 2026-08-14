import { apiFetch } from '@/lib/apiFetch';

export interface Door {
  id: number;
  building_id: number;
  name: string;
  door_code: string;
  mqtt_topic: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Building {
  id: number;
  project_id: string;
  name: string;
  address: string;
  contract_address: string;
  created_at: string;
  updated_at: string;
}

export interface VerifyResponse {
  success: boolean;
  message: string;
  data?: {
    success: boolean;
    message: string;
    token?: string;
  };
}

export interface ListResponse<T> {
  success: boolean;
  data: T[];
}

/**
 * Verify access to a door using the provided code.
 */
export async function verifyAccess(
  doorCode: string,
  code: string,
): Promise<{ success: boolean; message: string }> {
  const res = await apiFetch('/api/verify/access', {
    method: 'POST',
    body: JSON.stringify({
      door_code: doorCode,
      code,
      method: 'totp',
      timestamp: Date.now(),
    }),
  });

  const data: VerifyResponse = await res.json();

  if (!res.ok) {
    return {
      success: false,
      message: data.message || 'Verification failed',
    };
  }

  return {
    success: data.data?.success ?? false,
    message: data.data?.message ?? data.message ?? 'Verification completed',
  };
}

/**
 * Fetch all doors for the current project.
 */
export async function getDoors(): Promise<Door[]> {
  const res = await apiFetch('/api/doors');
  if (!res.ok) return [];
  const data: ListResponse<Door> = await res.json();
  return data.data ?? [];
}

/**
 * Fetch all buildings for the current project.
 */
export async function getBuildings(): Promise<Building[]> {
  const res = await apiFetch('/api/buildings');
  if (!res.ok) return [];
  const data: ListResponse<Building> = await res.json();
  return data.data ?? [];
}

/**
 * Get building name by ID.
 */
export function getBuildingName(buildings: Building[], buildingId: number): string {
  const building = buildings.find((b) => b.id === buildingId);
  return building?.name ?? `Building ${buildingId}`;
}

/**
 * Get door name by code.
 */
export function getDoorName(doors: Door[], doorCode: string): string {
  const door = doors.find((d) => d.door_code === doorCode);
  return door?.name ?? doorCode;
}
