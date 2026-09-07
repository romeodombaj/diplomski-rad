import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LockdownService, type LockdownState } from './lockdown.service';

/**
 * One shared lockdown state for the whole shell.
 *
 * The emergency button lives in the sidebar and the unlock buttons live on the
 * dashboard, the doors table and the door detail page. Fetching the state in
 * each of them would let them disagree: engaging a lockdown in the sidebar
 * would leave four unlock buttons still looking usable until their own pages
 * happened to refetch, and an operator would reasonably read an enabled button
 * as permission.
 *
 * This is a convenience for the operator, not a control. The backend refuses
 * the unlock regardless of what this says — see doorService.unlock, which
 * records the refusal as a denied event.
 */
interface LockdownContextValue {
  state: LockdownState | null;
  /** True while the building-wide emergency is engaged. */
  buildingLocked: boolean;
  /** Whether this specific door refuses to open, for either reason. */
  isDoorBlocked: (doorId: number) => boolean;
  refresh: () => Promise<void>;
  setBuilding: (active: boolean) => Promise<void>;
  setDoor: (doorId: number, lockedDown: boolean) => Promise<void>;
}

const LockdownContext = createContext<LockdownContextValue | null>(null);

export function LockdownProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LockdownState | null>(null);

  // A failed fetch keeps the last known state rather than clearing it: an
  // unreachable backend is not evidence that a lockdown was lifted, and
  // showing "no lockdown" on a network blip is the wrong way to be wrong.
  const refresh = useCallback(async () => {
    try { setState(await LockdownService.get()); } catch { /* keep last known */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo<LockdownContextValue>(() => {
    const buildingLocked = state?.building.active ?? false;
    return {
      state,
      buildingLocked,
      isDoorBlocked: (doorId: number) =>
        buildingLocked || Boolean(state?.doors.find((d) => d.id === doorId)?.locked_down),
      refresh,
      setBuilding: async (active) => { setState(await LockdownService.setBuilding(active)); },
      setDoor: async (doorId, lockedDown) => { setState(await LockdownService.setDoor(doorId, lockedDown)); },
    };
  }, [state, refresh]);

  return <LockdownContext.Provider value={value}>{children}</LockdownContext.Provider>;
}

/**
 * Safe outside the provider: components that render in isolation (tests, the
 * login shell) get "nothing is locked down" rather than a thrown error, and the
 * backend is still the thing that decides.
 */
export function useLockdown(): LockdownContextValue {
  return useContext(LockdownContext) ?? {
    state: null,
    buildingLocked: false,
    isDoorBlocked: () => false,
    refresh: async () => {},
    setBuilding: async () => {},
    setDoor: async () => {},
  };
}
