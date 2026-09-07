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
  /** Called after a successful override, so a detail page can refresh history. */
  onUnlocked?: () => void;
}

type Result =
  | { kind: 'unlocked' }
  | { kind: 'recorded' }
  | { kind: 'error'; message: string };

/**
 * Open one door from the dashboard.
 *
 * Confirmed rather than immediate: this physically opens a door in a building,
 * and it is the one control here whose effect cannot be undone by clicking
 * again. The dialog also says the override will be recorded, because an
 * operator should know that before they use it rather than discover it in an
 * audit — the backend records it either way (see doorService.unlock).
 *
 * Three outcomes, deliberately distinguished. A broker that did not take the
 * message is not a failure of the request: the override was authorised and
 * written to the access history, and the operator needs to know the lock did
 * not move so they can go and open it by hand.
 *
 * Under a lockdown the button is disabled and says so. That is presentation
 * only — the backend refuses the request and records the attempt as a denied
 * event either way, because a disabled button is not a security control. The
 * point of showing it here is that the operator learns why *before* clicking,
 * and knows the fix is to release the lockdown rather than to try again.
 */
export default function UnlockButton({ door, size = 'sm', variant = 'outline', onUnlocked }: Props) {
  const { t } = useTranslation();
  const { buildingLocked, isDoorBlocked } = useLockdown();
  // `door.locked_down` covers the door detail page, which holds a freshly
  // loaded door; isDoorBlocked covers the rest, and catches a lockdown engaged
  // after this row was fetched.
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
      // The outcome is the point of the interaction, so it stays up long enough
      // to read and then clears itself rather than needing a dismiss.
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
