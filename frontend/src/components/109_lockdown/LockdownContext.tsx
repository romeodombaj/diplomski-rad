import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LockdownService, type LockdownState } from './lockdown.service';

interface LockdownContextValue {
  state: LockdownState | null;
  buildingLocked: boolean;
  isDoorBlocked: (doorId: number) => boolean;
  refresh: () => Promise<void>;
  setBuilding: (active: boolean) => Promise<void>;
  setDoor: (doorId: number, lockedDown: boolean) => Promise<void>;
}

const LockdownContext = createContext<LockdownContextValue | null>(null);

export function LockdownProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LockdownState | null>(null);

  const refresh = useCallback(async () => {
    try { setState(await LockdownService.get()); } catch {  }
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
