import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Label } from '@/UI/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';
import { PolicyService, type GroupDetail, type AccessSchedule } from '../services/policy.service';
import { DoorService, type Door } from '@/components/105_doors/services/door.service';
import GroupMembers from './GroupMembers';

interface Props {
  groupId: number | null;
  onSaved: () => void;
  onCancel?: () => void;
  onLoaded?: (group: GroupDetail) => void;
}

export default function GroupPanel({ groupId, onSaved, onCancel, onLoaded }: Props) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [doors, setDoors] = useState<Door[]>([]);
  const [schedules, setSchedules] = useState<AccessSchedule[]>([]);
  const [selected, setSelected] = useState<Map<number, number | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!groupId) return;
    setError(null);
    try {
      const [g, doorPage, scheds] = await Promise.all([
        PolicyService.getGroup(groupId),
        DoorService.getAll('', null, 200),
        PolicyService.listSchedules(),
      ]);
      setGroup(g);
      setDoors(doorPage.data);
      setSchedules(scheds);
      setSelected(new Map(g.doors.map((d) => [d.door_id, d.schedule_id])));
      onLoaded?.(g);
    } catch (e: any) {
      setError(e.message);
    }
  }, [groupId, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const toggle = (doorId: number) => {
    const next = new Map(selected);
    if (next.has(doorId)) next.delete(doorId);
    else next.set(doorId, null);
    setSelected(next);
  };

  const setSchedule = (doorId: number, scheduleId: number | null) => {
    const next = new Map(selected);
    next.set(doorId, scheduleId);
    setSelected(next);
  };

  const fanOut = useMemo(() => {
    if (!group) return { added: 0, removed: 0, members: 0, transactions: 0 };
    const before = new Set(group.doors.map((d) => d.door_id));
    const after = new Set(selected.keys());
    const added = [...after].filter((d) => !before.has(d)).length;
    const removed = [...before].filter((d) => !after.has(d)).length;
    const members = group.members.length;
    return { added, removed, members, transactions: (added + removed) * members };
  }, [group, selected]);

  const save = async () => {
    if (!groupId) return;
    setSaving(true);
    setError(null);
    try {
      await PolicyService.setGroupDoors(
        groupId,
        [...selected.entries()].map(([door_id, schedule_id]) => ({ door_id, schedule_id })),
      );
      await load();
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-destructive text-sm">{error}</p>}

      <div>
        <Label className="mb-2 block">{t('access.groups.doors')}</Label>
        <div className="space-y-2 rounded-md border p-2 max-h-96 overflow-y-auto">
          {doors.length === 0 && (
            <p className="text-muted-foreground text-sm p-2">{t('access.groups.noDoors')}</p>
          )}
          {doors.map((door) => {
            const on = selected.has(door.id);
            return (
              <div key={door.id} className="flex items-center gap-2 rounded p-1 hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={on}
                  onChange={() => toggle(door.id)}
                  id={`door-${door.id}`}
                />
                <label htmlFor={`door-${door.id}`} className="flex-1 text-sm cursor-pointer">
                  {door.name}{' '}
                  <span className="text-muted-foreground font-mono text-xs">{door.door_code}</span>
                  {!door.active && (
                    <Badge variant="outline" className="ml-2">{t('access.groups.inactive')}</Badge>
                  )}
                </label>
                {on && (
                  <Select
                    value={String(selected.get(door.id) ?? 'none')}
                    onValueChange={(v) => setSchedule(door.id, v === 'none' ? null : Number(v))}
                  >
                    <SelectTrigger className="w-40 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('access.groups.allHours')}</SelectItem>
                      {schedules.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {fanOut.transactions > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {t('access.groups.fanOutTitle')}
          </div>
          <p className="text-muted-foreground mt-1">
            {t('access.groups.fanOutBody', {
              added: fanOut.added,
              removed: fanOut.removed,
              members: fanOut.members,
              transactions: fanOut.transactions,
            })}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="flex-1">
          {saving ? t('access.groups.saving') : t('access.groups.save')}
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            {t('access.groups.cancel')}
          </Button>
        )}
      </div>

      {
}
      {group && (
        <div className="border-t pt-4">
          <GroupMembers
            group={group}
            onChanged={() => { load(); onSaved(); }}
          />
        </div>
      )}
    </div>
  );
}
