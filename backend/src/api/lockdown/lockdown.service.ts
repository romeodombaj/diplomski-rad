import db from '../../db';
import logger from '../../lib/logger';

/**
 * Lockdown — refusing entry while the hardware is perfectly healthy.
 *
 * Kept separate from `doors.active` on purpose. Inactive is administrative:
 * out of service, not installed, under repair. Lockdown is a security action
 * taken in a hurry, and the audit trail has to be able to tell an emergency
 * apart from a maintenance ticket afterwards.
 *
 * Nothing here opens anything. Releasing a lockdown restores the *normal*
 * rules — signature, TOTP, face, policy and schedule all still apply.
 */

export interface LockdownState {
  building: { active: boolean; since: string | null; by: string | null };
  doors: {
    id: number; name: string; door_code: string;
    locked_down: boolean; since: string | null;
  }[];
}

export const getState = async (buildingId: number): Promise<LockdownState> => {
  const building = await db('buildings').where({ id: buildingId }).first();
  const doors = await db('doors')
    .where({ building_id: buildingId })
    .whereNull('deleted_at')
    .orderBy('name')
    .select('id', 'name', 'door_code', 'locked_down', 'locked_down_at');

  return {
    building: {
      active: Boolean(building?.lockdown_at),
      since: building?.lockdown_at ?? null,
      by: building?.lockdown_by ?? null,
    },
    doors: doors.map((d: any) => ({
      id: d.id,
      name: d.name,
      door_code: d.door_code,
      locked_down: Boolean(d.locked_down),
      since: d.locked_down_at ?? null,
    })),
  };
};

/** Lock or release one door. */
export const setDoor = async (
  buildingId: number,
  doorId: number,
  lockedDown: boolean,
  operator?: string,
): Promise<{ ok: boolean }> => {
  const updated = await db('doors')
    .where({ id: doorId, building_id: buildingId })
    .whereNull('deleted_at')
    .update({
      locked_down: lockedDown,
      locked_down_at: lockedDown ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });

  if (!updated) return { ok: false };
  logger.warn(
    `[lockdown] door ${doorId} ${lockedDown ? 'LOCKED DOWN' : 'released'} by ${operator ?? 'unknown'}`,
  );
  return { ok: true };
};

/**
 * Building-wide emergency lockdown.
 *
 * Only the building flag is written — individual doors are left exactly as they
 * were. That is what makes this reversible: a door an operator locked by hand
 * before the emergency must stay locked when the emergency is lifted, and
 * sweeping every door here would silently release it.
 */
export const setBuilding = async (
  buildingId: number,
  active: boolean,
  operator?: string,
): Promise<LockdownState> => {
  await db('buildings').where({ id: buildingId }).update({
    lockdown_at: active ? new Date().toISOString() : null,
    lockdown_by: active ? (operator ?? null) : null,
    updated_at: new Date().toISOString(),
  });

  logger.warn(
    `[lockdown] building ${buildingId} EMERGENCY LOCKDOWN ${active ? 'ENGAGED' : 'RELEASED'} by ${operator ?? 'unknown'}`,
  );
  return getState(buildingId);
};
