import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/UI/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/UI/alert-dialog';
import { Radio, Pencil, Trash2, DoorOpen, Cpu } from 'lucide-react';
import { DeviceService, type Device } from './services/device.service';
import DeviceForm from './device/DeviceForm';
import ScanDialog from './components/ScanDialog';

/** Colour by role, so the inventory reads at a glance. */
const KIND_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  beacon: 'default',
  indicator: 'secondary',
  lock: 'outline',
  other: 'outline',
};

export default function Devices() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [presetAddress, setPresetAddress] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [deleting, setDeleting] = useState<Device | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDevices((await DeviceService.getAll()).data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function add(address: string | null = null) {
    setEditing(null);
    setPresetAddress(address);
    setFormOpen(true);
  }

  return (
    <div className="p-0 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('devices.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('devices.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setScanOpen(true)}>
            <Radio className="mr-2 h-4 w-4" />{t('devices.scan')}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('devices.fields.name')}</TableHead>
              <TableHead>{t('devices.fields.kind')}</TableHead>
              <TableHead>{t('devices.fields.address')}</TableHead>
              <TableHead>{t('devices.fields.door')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                {t('common.loading')}
              </TableCell></TableRow>
            )}
            {!loading && devices.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-10 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Cpu className="h-7 w-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('devices.empty')}</p>
                  <Button size="sm" onClick={() => setScanOpen(true)}>
                    <Radio className="mr-2 h-4 w-4" />{t('devices.scan')}
                  </Button>
                </div>
              </TableCell></TableRow>
            )}
            {devices.map((d) => (
              <TableRow
                key={d.id}
                className="cursor-pointer"
                onClick={() => { setEditing(d); setPresetAddress(null); setFormOpen(true); }}
              >
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>
                  <Badge variant={KIND_VARIANT[d.kind] ?? 'outline'}>
                    {t(`devices.kind.${d.kind}`)}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs break-all">{d.address ?? '—'}</TableCell>
                <TableCell>
                  {d.door_name ? (
                    <span className="inline-flex items-center gap-1 text-sm">
                      <DoorOpen className="h-3 w-3 text-muted-foreground" />
                      {d.door_name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">{t('devices.unassigned')}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon"
                      onClick={(e) => { e.stopPropagation(); setEditing(d); setPresetAddress(null); setFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon"
                      onClick={(e) => { e.stopPropagation(); setDeleting(d); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DeviceForm
        open={formOpen}
        onOpenChange={setFormOpen}
        device={editing}
        presetAddress={presetAddress}
        onSaved={load}
      />

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onAdd={(topic) => { setScanOpen(false); add(topic); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('devices.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('devices.deleteHint', { name: deleting?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleting) await DeviceService.remove(deleting.id);
                setDeleting(null);
                load();
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
