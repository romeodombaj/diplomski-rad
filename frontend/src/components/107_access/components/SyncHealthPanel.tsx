import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, Link2, Link2Off, ShieldAlert } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/UI/card';
import { PolicyService, type DriftRow, type SyncHealth } from '../services/policy.service';

export default function SyncHealthPanel() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [drift, setDrift] = useState<DriftRow[]>([]);
  const [busy, setBusy] = useState<null | 'sync' | 'reconcile'>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, d] = await Promise.all([PolicyService.health(), PolicyService.listDrift()]);
      setHealth(h);
      setDrift(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (which: 'sync' | 'reconcile') => {
    setBusy(which);
    setNote(null);
    try {
      if (which === 'sync') {
        const r = await PolicyService.sync();
        setNote(r.skipped ? t('access.health.chainOff') :
          t('access.health.syncDone', { granted: r.granted, revoked: r.revoked, failed: r.failed }));
      } else {
        const r = await PolicyService.reconcile();
        setNote(r.skipped ? t('access.health.chainOff') :
          t('access.health.reconcileDone', { checked: r.checked, unauthorised: r.unauthorised }));
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const chainOn = health?.chain.enabled ?? false;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {chainOn ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
            {t('access.health.chain')}
          </CardTitle>
          <CardDescription>
            {chainOn ? health?.chain.network : (health?.chain.reason ?? t('access.health.chainOff'))}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {chainOn && health?.chain.addresses ? (
            Object.entries(health.chain.addresses).map(([name, addr]) => (
              <div key={name} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{name}</span>
                <span className="font-mono" title={addr}>{addr.slice(0, 10)}…</span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">{t('access.health.chainOffHint')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('access.health.policies')}</CardTitle>
          <CardDescription>{t('access.health.policiesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="default">{t('access.sync.synced')}: {health?.synced ?? 0}</Badge>
            <Badge variant="secondary">{t('access.sync.pending')}: {health?.pending ?? 0}</Badge>
            {(health?.failed ?? 0) > 0 && (
              <Badge variant="destructive">{t('access.sync.failed')}: {health?.failed}</Badge>
            )}
          </div>
          <Button
            variant="outline" size="sm" className="w-full"
            disabled={busy !== null}
            onClick={() => run('sync')}
          >
            <RefreshCw className={`mr-2 h-3 w-3 ${busy === 'sync' ? 'animate-spin' : ''}`} />
            {t('access.health.pushPending')}
          </Button>
        </CardContent>
      </Card>

      <Card className={drift.length ? 'border-destructive' : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {drift.length > 0 && <ShieldAlert className="h-4 w-4 text-destructive" />}
            {t('access.health.drift')}
          </CardTitle>
          <CardDescription>{t('access.health.driftHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {drift.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('access.health.noDrift')}</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {drift.map((d) => (
                <div key={d.id} className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                    <span className="font-medium">{t(`access.drift.${d.kind}`)}</span>
                    <Badge variant={d.severity === 'high' ? 'destructive' : 'secondary'}>
                      {d.severity}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1">{d.detail}</p>
                  {d.door_code && (
                    <p className="font-mono mt-1 truncate" title={d.did ?? ''}>
                      {d.door_code} · {d.did?.slice(0, 22)}…
                    </p>
                  )}
                  <Button
                    variant="ghost" size="sm" className="mt-1 h-6 px-2 text-xs"
                    onClick={async () => { await PolicyService.resolveDrift(d.id); load(); }}
                  >
                    {t('access.health.acknowledge')}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="outline" size="sm" className="w-full"
            disabled={busy !== null}
            onClick={() => run('reconcile')}
          >
            <RefreshCw className={`mr-2 h-3 w-3 ${busy === 'reconcile' ? 'animate-spin' : ''}`} />
            {t('access.health.runReconcile')}
          </Button>
        </CardContent>
      </Card>

      {(note || error) && (
        <div className="md:col-span-3">
          {note && <p className="text-muted-foreground text-sm">{note}</p>}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      )}
    </div>
  );
}
