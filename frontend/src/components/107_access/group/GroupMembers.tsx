import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, UserPlus, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Label } from '@/UI/label';
import { SearchInput } from '@/UI/SearchInput';
import { PolicyService, type GroupDetail } from '../services/policy.service';
import { PersonService, type Person } from '@/components/106_people/services/person.service';

interface Props {
  group: GroupDetail;
  /** Reload the group after a membership change. */
  onChanged: () => void;
}

/**
 * Who is in this group, with add and remove.
 *
 * Membership was read-only before, which made the group screen half a feature:
 * an operator could define what a group opens but had to go to each person in
 * turn to put anybody in it. The two operations are separate endpoints and take
 * effect immediately rather than on a save button, because each one is a
 * complete change on its own — batching them would only make a partial failure
 * harder to report.
 *
 * The fan-out line is not decoration. The chain stores one flat (did, doorCode)
 * policy per door, so adding one person to a group of six doors is six
 * transactions. An operator adding twenty people deserves that number before
 * they start, not after.
 */
export default function GroupMembers({ group, onChanged }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const memberIds = useMemo(() => new Set(group.members.map((m) => m.id)), [group.members]);

  const search = useCallback(async (q: string) => {
    setSearching(true);
    try {
      // Only people who could actually use a credential. An offboarded person
      // in an access group is a grant that will never open anything and a row
      // in every future audit asking why it exists.
      const page = await PersonService.getAll(q, null, 20, false, { status: 'active' });
      setCandidates(page.data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Search failed');
    } finally {
      setSearching(false);
    }
  }, []);

  // SearchInput debounces its own keystrokes, so this only reacts to a settled
  // query — and re-runs after a membership change so an added person leaves the
  // candidate list without a second search.
  useEffect(() => { search(query); }, [query, search, group.members.length]);

  const add = async (person: Person) => {
    setBusyId(person.id);
    setError(null);
    try {
      await PolicyService.assignGroup(person.id, group.id);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add');
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (personId: string) => {
    setBusyId(personId);
    setError(null);
    try {
      await PolicyService.unassignGroup(personId, group.id);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to remove');
    } finally {
      setBusyId(null);
    }
  };

  const unassigned = candidates.filter((p) => !memberIds.has(p.id));

  return (
    <div className="space-y-4">
      {error && <p className="text-destructive text-sm">{error}</p>}

      <div>
        <Label className="mb-2 block">
          {t('access.groups.members')} ({group.members.length})
        </Label>
        <div className="rounded-md border divide-y max-h-64 overflow-y-auto">
          {group.members.length === 0 && (
            <p className="text-muted-foreground p-3 text-sm">{t('access.groups.noMembers')}</p>
          )}
          {group.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span className="min-w-0 truncate">
                {m.full_name}
                {m.employee_no && (
                  <span className="text-muted-foreground font-mono text-xs ml-2">
                    {m.employee_no}
                  </span>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">{m.status}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === m.id}
                  title={t('access.groups.removeMember')}
                  onClick={() => removeMember(m.id)}
                >
                  {busyId === m.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-2 block">{t('access.groups.addMember')}</Label>
        <SearchInput
          onSearch={setQuery}
          isLoading={searching}
          placeholder={t('access.groups.searchPeople')}
        />

        {group.doors.length > 0 && (
          <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('access.groups.memberFanOut', { doors: group.doors.length })}
          </p>
        )}

        <div className="mt-2 rounded-md border divide-y max-h-56 overflow-y-auto">
          {searching && (
            <p className="text-muted-foreground p-3 text-sm">{t('common.loading')}</p>
          )}
          {!searching && unassigned.length === 0 && (
            <p className="text-muted-foreground p-3 text-sm">
              {query ? t('access.groups.noMatches') : t('access.groups.everyoneIn')}
            </p>
          )}
          {!searching && unassigned.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span className="min-w-0 truncate">
                {p.full_name}
                {p.department && (
                  <span className="text-muted-foreground text-xs ml-2">{p.department}</span>
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === p.id}
                onClick={() => add(p)}
              >
                {busyId === p.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserPlus className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
