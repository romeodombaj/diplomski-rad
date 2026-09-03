import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/UI/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/UI/table';
import {
  BehaviorService, type PersonBehaviour, type ScoreFactor, type ScoredEvent,
} from '../services/behavior.service';

/**
 * What the behaviour engine thinks of one person.
 *
 * The score is never shown on its own. An anomaly score is a claim about
 * somebody's movements that an operator may act on, and "0.87" is not something
 * anyone can agree or disagree with — so every number here is shown next to
 * what it was measured against: the hours, doors and rhythm the model was
 * fitted on, and which of those the flagged event departed from.
 *
 * The page also has to survive the engine being off. Everything under
 * "observed" comes from `access_events`, which this backend owns; only the
 * model half needs the microservice, and its absence is stated rather than
 * rendered as a clean bill of health.
 */
export default function BehaviourPanel({ personId }: { personId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<PersonBehaviour | null>(null);
  const [busy, setBusy] = useState<null | 'train' | 'seed'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await BehaviorService.forPerson(personId));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  const run = async (which: 'train' | 'seed') => {
    setBusy(which);
    setNote(null);
    try {
      if (which === 'train') {
        const r = await BehaviorService.train(personId);
        setNote(r.model_fitted
          ? t('people.detail.behaviour.trained', { n: r.events })
          : t('people.detail.behaviour.tooLittle', { n: r.events, needed: r.min_events_to_fit }));
      } else {
        const r = await BehaviorService.seed(personId);
        setNote(t('people.detail.behaviour.seeded', { n: r.events_generated }));
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return <p className="text-muted-foreground p-2 text-sm">{error ?? t('people.detail.loading')}</p>;
  }

  const { engine, profile, observed, latest, recent } = data;
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  /** A factor line: the value, what it is usually, and how much it mattered. */
  const FactorRow = ({ f }: { f: ScoreFactor }) => (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="text-muted-foreground">{t(`people.detail.behaviour.factors.${f.factor}`, f.factor)}: </span>
          <span className="font-medium">{f.value}</span>
        </span>
        <span className="text-muted-foreground text-xs">{pct(f.share)}</span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full" style={{ width: pct(f.share) }} />
      </div>
      <p className="text-muted-foreground text-xs">
        {t('people.detail.behaviour.usually')}: {f.usual}
      </p>
    </div>
  );

  const ScoreBadge = ({ event }: { event: ScoredEvent }) => (
    <Badge variant={event.anomaly_flagged ? 'destructive' : 'secondary'}>
      {event.anomaly_score?.toFixed(2) ?? '—'}
    </Badge>
  );

  return (
    <div className="space-y-4">
      {/* The engine is optional. Say which of the two halves below is missing
          rather than letting a quiet page read as "nothing to worry about". */}
      {!engine.enabled && (
        <p className="text-muted-foreground text-sm">{t('people.detail.behaviour.engineOff')}</p>
      )}
      {engine.enabled && !engine.reachable && (
        <p className="text-destructive text-sm">{t('people.detail.behaviour.engineDown')}</p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className={latest?.anomaly_flagged ? 'border-destructive' : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {latest?.anomaly_flagged
                ? <AlertTriangle className="text-destructive h-4 w-4" />
                : <Activity className="h-4 w-4" />}
              {t('people.detail.behaviour.latestScore')}
            </CardTitle>
            <CardDescription>{t('people.detail.behaviour.latestHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!latest ? (
              <p className="text-muted-foreground text-sm">{t('people.detail.behaviour.noScores')}</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-semibold ${latest.anomaly_flagged ? 'text-destructive' : ''}`}>
                    {latest.anomaly_score?.toFixed(2)}
                  </span>
                  <Badge variant={latest.anomaly_flagged ? 'destructive' : 'default'}>
                    {t(latest.anomaly_flagged
                      ? 'people.detail.behaviour.anomalous'
                      : 'people.detail.behaviour.normal')}
                  </Badge>
                </div>
                {/* 0.5 is the model's own boundary, not a display convention. */}
                <p className="text-muted-foreground text-xs">{t('people.detail.behaviour.scaleHint')}</p>
                <p className="text-sm">
                  {latest.door_name ?? latest.door_code} ·{' '}
                  {new Date(latest.occurred_at).toLocaleString()}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('people.detail.behaviour.whyTitle')}</CardTitle>
            <CardDescription>{t('people.detail.behaviour.whyHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!latest || latest.factors.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('people.detail.behaviour.noFactors')}</p>
            ) : (
              latest.factors.filter((f) => f.delta > 0).map((f) => <FactorRow key={f.factor} f={f} />)
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('people.detail.behaviour.baselineTitle')}</CardTitle>
            <CardDescription>{t('people.detail.behaviour.baselineHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!profile?.model_trained ? (
              <p className="text-muted-foreground text-sm">
                {t('people.detail.behaviour.noBaseline', {
                  have: observed.total,
                  needed: profile?.min_events_to_fit ?? 20,
                })}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {t('people.detail.behaviour.fittedOn', { n: profile.events_in_baseline })}
                  </Badge>
                  {/* A generated baseline is never allowed to read as an
                      observed one — see specs/BEHAVIOR_ENGINE_NOTES.md §1. */}
                  {profile.synthetic && (
                    <Badge variant="outline" title={t('people.detail.behaviour.syntheticHint')}>
                      <Sparkles className="mr-1 h-3 w-3" />{t('people.detail.behaviour.synthetic')}
                    </Badge>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ['people.detail.behaviour.usualHours', `${profile.usual_from}–${profile.usual_to}`],
                    ['people.detail.behaviour.perDay', profile.events_per_day.toFixed(1)],
                    ['people.detail.behaviour.typicalGap', t('people.detail.behaviour.minutes', { n: Math.round(profile.median_gap_minutes) })],
                    ['people.detail.behaviour.nightShare', pct(profile.night_share)],
                  ] as const).map(([key, value]) => (
                    <div key={key}>
                      <p className="text-muted-foreground text-xs">{t(key)}</p>
                      <p className="text-sm">{value}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" disabled={busy !== null || !engine.enabled} onClick={() => run('train')}>
                <RefreshCw className={`mr-2 h-3 w-3 ${busy === 'train' ? 'animate-spin' : ''}`} />
                {t('people.detail.behaviour.train')}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy !== null || !engine.enabled} onClick={() => run('seed')}>
                <Sparkles className="mr-2 h-3 w-3" />
                {t('people.detail.behaviour.seed')}
              </Button>
            </div>
            {note && <p className="text-muted-foreground text-sm">{note}</p>}
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('people.detail.behaviour.observedTitle')}</CardTitle>
            <CardDescription>{t('people.detail.behaviour.observedHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {t('people.detail.behaviour.events', { n: observed.total })}
              </Badge>
              <Badge variant="outline">
                {t('people.detail.behaviour.scored', { n: observed.scored })}
              </Badge>
              {observed.flagged > 0 && (
                <Badge variant="destructive">
                  {t('people.detail.behaviour.flagged', { n: observed.flagged })}
                </Badge>
              )}
            </div>

            {/* Time of day is the signal the whole engine leans on, so it is
                worth showing as a shape rather than a statistic. */}
            <div>
              <p className="text-muted-foreground mb-1 text-xs">{t('people.detail.behaviour.byHour')}</p>
              <div className="flex h-16 items-end gap-[2px]">
                {observed.byHour.map(({ hour, count }) => {
                  const peak = Math.max(1, ...observed.byHour.map((h) => h.count));
                  return (
                    <div
                      key={hour}
                      title={`${String(hour).padStart(2, '0')}:00 — ${count}`}
                      className="bg-primary/70 min-h-[2px] w-full rounded-sm"
                      style={{ height: `${(count / peak) * 100}%` }}
                    />
                  );
                })}
              </div>
              <div className="text-muted-foreground flex justify-between text-[10px]">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">{t('people.detail.behaviour.byDoor')}</p>
              {observed.byDoor.length === 0 && (
                <p className="text-muted-foreground text-sm">{t('people.detail.behaviour.noHistory')}</p>
              )}
              {observed.byDoor.slice(0, 5).map((d) => (
                <div key={d.door_code} className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate font-mono">{d.door_code}</span>
                  <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                    <div className="bg-primary h-full rounded-full" style={{ width: pct(d.share) }} />
                  </div>
                  <span className="text-muted-foreground w-10 text-right">{pct(d.share)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('people.detail.behaviour.recentTitle')}</CardTitle>
          <CardDescription>{t('people.detail.behaviour.recentHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('people.detail.behaviour.when')}</TableHead>
                <TableHead>{t('people.detail.door')}</TableHead>
                <TableHead>{t('people.detail.behaviour.score')}</TableHead>
                <TableHead>{t('people.detail.behaviour.why')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {t('people.detail.behaviour.noScores')}
                  </TableCell>
                </TableRow>
              )}
              {recent.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{e.door_code}</TableCell>
                  <TableCell><ScoreBadge event={e} /></TableCell>
                  <TableCell className="text-xs">
                    {e.factors[0]
                      ? `${t(`people.detail.behaviour.factors.${e.factors[0].factor}`, e.factors[0].factor)}: ${e.factors[0].value}`
                      : (e.anomaly_reason ?? '—')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
