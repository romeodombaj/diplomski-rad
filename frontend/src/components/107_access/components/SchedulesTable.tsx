import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Info } from 'lucide-react';
import { Button } from '@/UI/button';
import { Input } from '@/UI/input';
import { Label } from '@/UI/label';
import { Badge } from '@/UI/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/UI/table';
import { PolicyService, type AccessSchedule } from '../services/policy.service';

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinutes = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Weekly windows.
 *
 * These are enforced by the backend, not the chain — `AccessPolicy` holds one
 * contiguous [start, end] and cannot express "Mon-Fri 09:00-17:00". What goes
 * on chain is a hash of the schedule, so the backend can be caught presenting
 * a different one than it committed to. Editing a schedule therefore changes
 * the commitment, which means re-granting: hence the warning on delete.
 */
export default function SchedulesTable() {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<AccessSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState<Set<string>>(new Set(['MO', 'TU', 'WE', 'TH', 'FR']));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');

  const load = useCallback(async () => {
    try {
      setSchedules(await PolicyService.listSchedules());
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || days.size === 0) return;
    try {
      await PolicyService.createSchedule({
        name: name.trim(),
        rrule: `FREQ=WEEKLY;BYDAY=${[...days].join(',')}`,
        start_minute: toMinutes(start),
        end_minute: toMinutes(end),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zagreb',
      });
      setName('');
      load();
    } catch (e: any) { setError(e.message); }
  };

  const toggleDay = (d: string) => {
    const next = new Set(days);
    next.has(d) ? next.delete(d) : next.add(d);
    setDays(next);
  };

  return (
    <>
      <div className="mb-4 space-y-3 rounded-md border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t('access.schedules.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('access.schedules.namePlaceholder')} className="w-56" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t('access.schedules.from')}</Label>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t('access.schedules.to')}</Label>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" />
          </div>
          <Button onClick={create} disabled={!name.trim() || days.size === 0}>
            <Plus className="mr-1 h-4 w-4" />{t('access.schedules.add')}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1">
          {DAYS.map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={days.has(d) ? 'default' : 'outline'}
              onClick={() => toggleDay(d)}
              className="w-12"
            >
              {d}
            </Button>
          ))}
        </div>

        {toMinutes(end) <= toMinutes(start) && (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Info className="h-3 w-3" />
            {t('access.schedules.overnightHint')}
          </p>
        )}
      </div>

      {error && <p className="text-destructive text-sm mb-2">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('access.schedules.name')}</TableHead>
              <TableHead>{t('access.schedules.days')}</TableHead>
              <TableHead>{t('access.schedules.window')}</TableHead>
              <TableHead>{t('access.schedules.timezone')}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {t('access.schedules.empty')}
                </TableCell>
              </TableRow>
            )}
            {schedules.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(/BYDAY=([A-Z,]+)/.exec(s.rrule)?.[1] ?? '').split(',').filter(Boolean).map((d) => (
                      <Badge key={d} variant="outline">{d}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {hhmm(s.start_minute)}–{hhmm(s.end_minute)}
                  {s.end_minute <= s.start_minute && (
                    <Badge variant="secondary" className="ml-2">{t('access.schedules.overnight')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{s.timezone}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon"
                    onClick={async () => { await PolicyService.deleteSchedule(s.id); load(); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
