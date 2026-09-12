import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Lock, LockOpen } from 'lucide-react';
import { useLockdown } from './LockdownContext';

interface Props {
  doorId: number;
  lockedDown: boolean;
  onChanged?: (lockedDown: boolean) => void;
  disabled?: boolean;
}

export default function DoorLockdownButton({ doorId, lockedDown, onChanged, disabled }: Props) {
  const { t } = useTranslation();
  const { setDoor, buildingLocked } = useLockdown();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await setDoor(doorId, !lockedDown);
      onChanged?.(!lockedDown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={lockedDown ? 'destructive' : 'outline'}
      size="sm"
      onClick={toggle}
      disabled={disabled || busy}
      className="gap-1.5"
      title={buildingLocked ? t('lockdown.buildingOverrides') : undefined}
    >
      {lockedDown
        ? <><LockOpen className="h-3.5 w-3.5" />{t('lockdown.unlockDoor')}</>
        : <><Lock className="h-3.5 w-3.5" />{t('lockdown.lockDoor')}</>}
    </Button>
  );
}
