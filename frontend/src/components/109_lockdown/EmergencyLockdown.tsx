import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/UI/alert-dialog';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { LockdownService, type LockdownState } from './lockdown.service';

/**
 * Building-wide emergency lockdown.
 *
 * Two things this deliberately is not. It is not a bigger version of taking a
 * door out of service — that is an administrative state and this is a security
 * action, and the audit trail has to tell them apart afterwards. And it is not
 * enforced here: the backend refuses every access request while it is engaged,
 * because the phone signs its own request and a modified client would not care
 * what this screen says.
 *
 * Both directions ask for confirmation. Engaging one locks everybody out of
 * everything, and lifting one is just as consequential — it restores entry to a
 * building somebody decided to seal.
 */
export default function EmergencyLockdown() {
  const { t } = useTranslation();
  const [state, setState] = useState<LockdownState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setState(await LockdownService.get()); } catch { /* leave the last known state */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = state?.building.active ?? false;

  async function toggle() {
    setBusy(true);
    try {
      setState(await LockdownService.setBuilding(!active));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={active ? 'outline' : 'destructive'}
        size="lg"
        className={`w-full gap-2 ${active ? 'border-destructive text-destructive' : ''}`}
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        {active
          ? <><ShieldCheck className="h-5 w-5" />{t('lockdown.release')}</>
          : <><ShieldAlert className="h-5 w-5" />{t('lockdown.engage')}</>}
      </Button>

      {active && (
        <p className="text-destructive text-center text-xs">
          {state?.building.since
            ? t('lockdown.activeSince', {
                time: new Date(state.building.since).toLocaleString(),
                by: state.building.by ?? '—',
              })
            : t('lockdown.activeNow')}
        </p>
      )}

      <AlertDialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {active ? t('lockdown.confirmReleaseTitle') : t('lockdown.confirmEngageTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {active ? t('lockdown.confirmReleaseHint') : t('lockdown.confirmEngageHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); toggle(); }}
              className={active ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
            >
              {active ? t('lockdown.release') : t('lockdown.engage')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
