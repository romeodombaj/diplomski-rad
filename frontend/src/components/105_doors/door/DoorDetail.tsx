import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Card, CardContent } from '@/UI/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/UI/table';
import { DoorService, type Door } from '../services/door.service';
import { PolicyService, type DoorAccessRow } from '@/components/107_access/services/policy.service';
import DoorDevices from '@/components/108_devices/components/DoorDevices';
import UnlockButton from '../components/UnlockButton';
import EditDoor from './EditDoor';

type Tab = 'details' | 'devices' | 'access';

/**
 * One door, as a page rather than a slide-over.
 *
 * A door is the join between three separate things — its own settings, the
 * hardware mounted at it, and who may open it. A sheet gave one narrow column
 * for all three and covered the list behind it; a page has room, and the URL
 * makes a specific door linkable and reloadable. Mirrors PersonDetail so both
 * records behave the same way.
 */
export default function DoorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [door, setDoor] = useState<Door | null>(null);
  const [access, setAccess] = useState<DoorAccessRow[]>([]);
  const [tab, setTab] = useState<Tab>('details');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setDoor(await DoorService.getById(Number(id)));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    }
    // Who may open it is a separate question and a separate endpoint; a failure
    // there should not blank the whole page.
    PolicyService.whoHasAccess(Number(id)).then(setAccess).catch(() => setAccess([]));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!door) {
    return <div className="text-muted-foreground p-6">{error ?? t('common.loading')}</div>;
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
    <div className="space-y-4 p-0 sm:p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/doors')}>
        <ArrowLeft className="mr-1 h-4 w-4" />{t('doors.detail.back')}
      </Button>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{door.name}</h1>
        <Badge variant={door.active ? 'default' : 'secondary'}>
          {door.active ? t('doors.detail.active') : t('doors.detail.inactive')}
        </Badge>
        <span className="text-muted-foreground font-mono text-sm">{door.door_code}</span>
        {/* Right-aligned: it is the one action on this page with a physical
            effect, so it does not sit in the run of identifying labels. */}
        <div className="ml-auto flex items-center">
          <UnlockButton door={door} onUnlocked={load} />
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-2 border-b">
        <TabButton value="details" label={t('doors.detail.tabs.details')} />
        <TabButton value="devices" label={t('doors.detail.tabs.devices')} />
        <TabButton value="access" label={t('doors.detail.tabs.access')} />
      </div>

      {tab === 'details' && (
        <EditDoor id={id} initialData={door} onSuccess={() => { load(); }} />
      )}

      {tab === 'devices' && (
        <Card><CardContent className="pt-6">
          <DoorDevices doorId={Number(id)} />
        </CardContent></Card>
      )}

      {tab === 'access' && (
        <Card><CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('doors.detail.person')}</TableHead>
                <TableHead>{t('doors.detail.via')}</TableHead>
                <TableHead>{t('doors.detail.hours')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {access.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-muted-foreground">
                  {t('doors.detail.noAccess')}
                </TableCell></TableRow>
              )}
              {access.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell>{a.full_name ?? a.person_name ?? '—'}</TableCell>
                  <TableCell><Badge variant="outline">{a.source_name ?? a.source}</Badge></TableCell>
                  <TableCell className="text-xs">{a.schedule ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
