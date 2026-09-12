import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen, Loader2, Check, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/UI/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/UI/alert-dialog';
import { DoorService, type Door } from '../services/door.service';
import { useLockdown } from '@/components/109_lockdown/LockdownContext';

interface Props {
  door: Pick<Door, 'id' | 'name' | 'door_code' | 'active'> & { locked_down?: boolean };
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline' | 'ghost';
  onUnlocked?: () => void;
}

type Result =
  | { kind: 'unlocked' }
  | { kind: 'recorded' }
  | { kind: 'error'; message: string };

export default function UnlockButton({ door, size = 'sm', variant = 'outline', onUnlocked }: Props) {
  const { t } = useTranslation();
  const { buildingLocked, isDoorBlocked } = useLockdown();
  const blocked = isDoorBlocked(door.id) || Boolean(door.locked_down);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await DoorService.unlock(door.id);
      setResult({ kind: res.unlocked ? 'unlocked' : 'recorded' });
      onUnlocked?.();
    } catch (e: any) {
      setResult({ kind: 'error', message: e?.message ?? t('doors.unlock.failed') });
    } finally {
      setBusy(false);
      setConfirming(false);
      setTimeout(() => setResult(null), 6000);
    }
  };

  return (
    <>
      <Button
        size={size}
        variant={variant}
        disabled={busy || !door.active || blocked}
        onClick={() => setConfirming(true)}
        title={
          blocked
            ? (buildingLocked ? t('doors.unlock.buildingLockdown') : t('doors.unlock.lockedDown'))
            : door.active ? undefined : t('doors.unlock.inactive')
        }
      >
        {busy ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : blocked ? (
          <ShieldAlert className="mr-1 h-4 w-4" />
        ) : (
          <DoorOpen className="mr-1 h-4 w-4" />
        )}
        {blocked ? t('doors.unlock.blocked') : t('doors.unlock.action')}
      </Button>

      {result && (
        <span
          className={`ml-2 inline-flex items-center gap-1 text-xs ${
            result.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {result.kind === 'unlocked' && (
            <><Check className="h-3.5 w-3.5" />{t('doors.unlock.opened')}</>
          )}
          {result.kind === 'recorded' && (
            <><AlertTriangle className="h-3.5 w-3.5" />{t('doors.unlock.recordedOnly')}</>
          )}
          {result.kind === 'error' && result.message}
        </span>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('doors.unlock.confirmTitle', { name: door.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('doors.unlock.confirmBody', { code: door.door_code })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={run}>{t('doors.unlock.action')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
