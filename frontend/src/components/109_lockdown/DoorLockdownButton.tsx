import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Lock, LockOpen } from 'lucide-react';
import { LockdownService } from './lockdown.service';

interface Props {
  doorId: number;
  lockedDown: boolean;
  onChanged?: (lockedDown: boolean) => void;
  disabled?: boolean;
}

/**
 * Hard-lock one door.
 *
 * Distinct from taking it out of service: this leaves the door installed and
 * working, and says nobody comes through it until somebody says otherwise. The
 * refusal happens on the access path, not here.
 */
export default function DoorLockdownButton({ doorId, lockedDown, onChanged, disabled }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await LockdownService.setDoor(doorId, !lockedDown);
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
    >
      {lockedDown
        ? <><LockOpen className="h-3.5 w-3.5" />{t('lockdown.unlockDoor')}</>
        : <><Lock className="h-3.5 w-3.5" />{t('lockdown.lockDoor')}</>}
    </Button>
  );
}
