import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Label } from '@/UI/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/UI/select';
import { Plus, X, Cpu } from 'lucide-react';
import { DeviceService, type Device } from '../services/device.service';

interface Props {
  doorId: number;
  disabled?: boolean;
}

/**
 * The hardware attached to one door, attachable from inside the door editor.
 *
 * Attachment lives on the device (`devices.door_id`), not on the door, because
 * hardware outlives the door it happens to be mounted at — a beacon can be
 * moved, and deleting a door leaves its devices intact and unassigned rather
 * than destroying the inventory record.
 */
export default function DoorDevices({ doorId, disabled }: Props) {
  const { t } = useTranslation();
  const [attached, setAttached] = useState<Device[]>([]);
  const [available, setAvailable] = useState<Device[]>([]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [mine, free] = await Promise.all([
      DeviceService.forDoor(doorId),
      DeviceService.getAll({ door_id: 'none' }),
    ]);
    setAttached(mine);
    setAvailable(free.data);
  }, [doorId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function attach() {
    if (!picked) return;
    setBusy(true);
    try {
      await DeviceService.update(Number(picked), { door_id: doorId });
      setPicked('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function detach(id: number) {
    setBusy(true);
    try {
      await DeviceService.update(id, { door_id: null });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label>{t('devices.attachedTitle')}</Label>

      <div className="rounded-md border divide-y">
        {attached.length === 0 && (
          <p className="text-muted-foreground p-3 text-sm">{t('devices.noneAttached')}</p>
        )}
        {attached.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 p-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{d.name}</span>
              <Badge variant="outline" className="shrink-0">{t(`devices.kind.${d.kind}`)}</Badge>
              {d.address && (
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {d.address}
                </span>
              )}
            </div>
            <Button
              type="button" variant="ghost" size="icon"
              disabled={disabled || busy}
              onClick={() => detach(d.id)}
              aria-label={t('devices.detach')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {!disabled && (
        <div className="flex gap-2">
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={t('devices.pickToAttach')} />
            </SelectTrigger>
            <SelectContent>
              {available.length === 0 && (
                <div className="text-muted-foreground p-2 text-sm">{t('devices.noneFree')}</div>
              )}
              {available.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.name} · {t(`devices.kind.${d.kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" onClick={attach} disabled={!picked || busy}>
            <Plus className="mr-1 h-4 w-4" />{t('devices.attach')}
          </Button>
        </div>
      )}
    </div>
  );
}
