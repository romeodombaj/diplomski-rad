import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, WifiOff, Link2Off } from 'lucide-react';
import { Button } from '@/UI/button';
import { Card, CardContent } from '@/UI/card';
import { Skeleton } from '@/UI/skeleton';
import { DashboardService, type DashboardOverview } from './services/dashboard.service';
import DoorCardTile from './components/DoorCard';
import ActivityChart from './components/ActivityChart';
import TodayOpeners from './components/TodayOpeners';

/** How often the page refreshes itself while it is open. */
const POLL_MS = 30_000;

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            tone === 'warn' && value !== 0 ? 'text-destructive' : ''
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The landing page: what happened today, and the doors, with the button that
 * opens them.
 *
 * Replaces the scaffold's demo panels, which showed invented revenue figures
 * and a hardcoded chart of two series called "desktop" and "mobile" — a page
 * that looked finished and told an operator nothing.
 *
 * The order is the operator's order of questions: is the system up, what
 * happened today, which door do I need to open, when was there traffic, who
 * came in. Doors come before the charts because opening one is the only action
 * on this page.
 *
 * It polls rather than subscribing. A WebSocket would be better and the backend
 * already has an event bus for it, but a 30-second poll of one small endpoint is
 * honest about what it costs and cannot get stuck holding a dead socket open.
 */
export default function Dashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      setData(await DashboardService.overview());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!data) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { totals, doors, openers, activity, health } = data;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {t('dashboard.refresh')}
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/*
        Infrastructure warnings first. A broker that is down means every unlock
        button on this page will record an event and open nothing, and the
        operator needs that before they press one, not after.
      */}
      {(!health.mqtt || !health.chain) && (
        <div className="flex flex-wrap gap-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {!health.mqtt && (
            <span className="flex items-center gap-1.5">
              <WifiOff className="h-4 w-4" />{t('dashboard.health.mqttDown')}
            </span>
          )}
          {!health.chain && (
            <span className="flex items-center gap-1.5">
              <Link2Off className="h-4 w-4" />{t('dashboard.health.chainOff')}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('dashboard.stats.grantedToday')} value={totals.granted_today} />
        <Stat label={t('dashboard.stats.deniedToday')} value={totals.denied_today} tone="warn" />
        <Stat
          label={t('dashboard.stats.doors')}
          value={
            totals.doors_inactive > 0
              ? `${totals.doors - totals.doors_inactive}/${totals.doors}`
              : totals.doors
          }
        />
        <Stat
          label={t('dashboard.stats.locks')}
          value={`${totals.locks_configured}/${totals.doors}`}
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">{t('dashboard.doors.title')}</h2>
        {doors.length === 0 ? (
          <Card><CardContent className="text-muted-foreground p-6 text-sm">
            {t('dashboard.doors.empty')}
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {doors.map((d) => (
              <DoorCardTile key={d.id} door={d} onUnlocked={() => load()} />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityChart data={activity} />
        </div>
        <TodayOpeners openers={openers} />
      </div>
    </div>
  );
}
