import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, Trash2, Smartphone, DoorOpen } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/UI/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/UI/table';
import { PersonService, type Person, type PersonDevice } from '../services/person.service';
import {
  PolicyService, type EffectiveAccess, type AccessGroup, type AccessSchedule,
} from '@/components/107_access/services/policy.service';
import { DoorService, type Door } from '@/components/105_doors/services/door.service';
import { SyncBadge } from '@/components/107_access/components/SyncBadge';
import BehaviourPanel from '../components/BehaviourPanel';

type Tab = 'profile' | 'credential' | 'access' | 'behaviour';

export default function PersonDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('profile');
  const [person, setPerson] = useState<Person | null>(null);
  const [devices, setDevices] = useState<PersonDevice[]>([]);
  const [access, setAccess] = useState<EffectiveAccess[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [schedules, setSchedules] = useState<AccessSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [grantDoor, setGrantDoor] = useState<string>('');
  const [grantSchedule, setGrantSchedule] = useState<string>('none');
  const [grantGroup, setGrantGroup] = useState<string>('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, d, a, doorPage, g, s] = await Promise.all([
        PersonService.getById(id),
        PersonService.listDevices(id),
        PolicyService.effectiveAccess(id),
        DoorService.getAll('', null, 200),
        PolicyService.listGroups(),
        PolicyService.listSchedules(),
      ]);
      setPerson(p); setDevices(d); setAccess(a);
      setDoors(doorPage.data); setGroups(g); setSchedules(s);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doGrant = async () => {
    if (!id || !grantDoor) return;
    try {
      await PolicyService.grantDirect({
        person_id: id,
        door_id: Number(grantDoor),
        schedule_id: grantSchedule === 'none' ? null : Number(grantSchedule),
      });
      setGrantDoor('');
      load();
    } catch (e: any) { setError(e.message); }
  };

  const doAssign = async () => {
    if (!id || !grantGroup) return;
    try {
      await PolicyService.assignGroup(id, Number(grantGroup));
      setGrantGroup('');
      load();
    } catch (e: any) { setError(e.message); }
  };

  if (!person) {
    return <div className="p-6 text-muted-foreground">{error ?? t('people.detail.loading')}</div>;
  }

  const TabButton = ({ value, label }: { value: Tab; label: string }) => (
    <Button
      variant="ghost"
      className={`rounded-none border-b-2 ${tab === value ? 'border-primary' : 'border-transparent'}`}
      onClick={() => setTab(value)}
    >
      {label}
    </Button>
  );

  return (
    <div className="p-0 sm:p-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/people')}>
        <ArrowLeft className="mr-1 h-4 w-4" />{t('people.detail.back')}
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{person.full_name}</h1>
        <Badge variant={person.status === 'active' ? 'default' : 'secondary'}>{person.status}</Badge>
        {person.employee_no && (
          <span className="text-muted-foreground text-sm">{person.employee_no}</span>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-2 border-b">
        <TabButton value="profile" label={t('people.detail.tabs.profile')} />
        <TabButton value="credential" label={t('people.detail.tabs.credential')} />
        <TabButton value="access" label={t('people.detail.tabs.access')} />
        <TabButton value="behaviour" label={t('people.detail.tabs.behaviour')} />
      </div>

      {tab === 'profile' && (
        <Card>
          <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
            {([
              ['people.columns.department', person.department],
              ['people.columns.jobTitle', person.job_title],
              ['people.columns.email', person.email],
              ['people.columns.phone', person.phone],
              ['people.columns.personType', person.person_type],
              ['people.columns.enrolledAt', person.enrolled_at],
            ] as const).map(([key, value]) => (
              <div key={key}>
                <p className="text-muted-foreground text-xs">{t(key)}</p>
                <p className="text-sm">{value || '—'}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === 'credential' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('people.detail.devices')}</CardTitle>
            <CardDescription>{t('people.detail.devicesHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-muted-foreground text-xs">{t('people.detail.did')}</p>
              <p className="font-mono text-xs break-all">{person.did ?? t('people.detail.noDid')}</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('people.detail.device')}</TableHead>
                  <TableHead>{t('people.detail.enrolled')}</TableHead>
                  <TableHead>{t('people.detail.state')}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      {t('people.detail.noDevices')}
                    </TableCell>
                  </TableRow>
                )}
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <Smartphone className="h-3 w-3" />{d.platform ?? '—'} {d.model ?? ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{new Date(d.enrolled_at).toLocaleString()}</TableCell>
                    <TableCell>
                      {d.revoked_at
                        ? <Badge variant="destructive">{t('people.detail.revoked')}</Badge>
                        : <Badge variant="default">{t('people.detail.activeDevice')}</Badge>}
                    </TableCell>
                    <TableCell>
                      {!d.revoked_at && (
                        <Button
                          variant="ghost" size="icon"
                          title={t('people.detail.revokeDevice')}
                          onClick={async () => {
                            await PersonService.revokeDevice(person.id, d.id, 'revoked from dashboard');
                            load();
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === 'access' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('people.detail.grantTitle')}</CardTitle>
              <CardDescription>{t('people.detail.grantHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!person.did && (
                // A policy is keyed by DID, so there is nothing to grant to
                // until the person has enrolled a phone.
                <p className="text-muted-foreground text-sm">{t('people.detail.needsEnrolment')}</p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <Select value={grantDoor} onValueChange={setGrantDoor}>
                  <SelectTrigger className="w-56"><SelectValue placeholder={t('people.detail.pickDoor')} /></SelectTrigger>
                  <SelectContent>
                    {doors.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name} ({d.door_code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={grantSchedule} onValueChange={setGrantSchedule}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('access.groups.allHours')}</SelectItem>
                    {schedules.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={doGrant} disabled={!grantDoor || !person.did}>
                  <Plus className="mr-1 h-4 w-4" />{t('people.detail.grant')}
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <Select value={grantGroup} onValueChange={setGrantGroup}>
                  <SelectTrigger className="w-56"><SelectValue placeholder={t('people.detail.pickGroup')} /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.name} ({g.door_count} {t('access.groups.doorsShort')})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={doAssign} disabled={!grantGroup || !person.did}>
                  {t('people.detail.addToGroup')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('people.detail.effectiveTitle')}</CardTitle>
              <CardDescription>{t('people.detail.effectiveHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('people.detail.door')}</TableHead>
                    {/* Provenance: "can open the server room" is useless without
                        "via Engineering" — that is what an admin changes. */}
                    <TableHead>{t('people.detail.via')}</TableHead>
                    <TableHead>{t('people.detail.hours')}</TableHead>
                    <TableHead>{t('people.detail.chain')}</TableHead>
                    <TableHead>{t('people.detail.openNow')}</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {access.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground">
                        {t('people.detail.noAccess')}
                      </TableCell>
                    </TableRow>
                  )}
                  {access.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                          <DoorOpen className="h-3 w-3 text-muted-foreground" />
                          {a.door_name} <span className="font-mono text-xs">{a.door_code}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.source === 'group' ? 'secondary' : 'outline'}>
                          {a.source_name}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{a.schedule}</TableCell>
                      <TableCell><SyncBadge status={a.sync_status} /></TableCell>
                      <TableCell>
                        {a.open_now
                          ? <Badge variant="default">{t('people.detail.yes')}</Badge>
                          : <Badge variant="outline">{t('people.detail.no')}</Badge>}
                      </TableCell>
                      <TableCell>
                        {a.source === 'direct' && a.sync_status !== 'revoked' && (
                          <Button
                            variant="ghost" size="icon"
                            title={t('people.detail.revokeGrant')}
                            onClick={async () => {
                              await PolicyService.revoke(a.id);
                              load();
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mounted only when open: the panel calls the behaviour engine, which is
          optional and can be slow, and no other tab should wait on it. */}
      {tab === 'behaviour' && <BehaviourPanel personId={person.id} />}
    </div>
  );
}
