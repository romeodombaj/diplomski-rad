import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/UI/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/UI/select';
import { Radio, Lock } from 'lucide-react';
import { DeviceService, type Device, type DeviceKind } from '../services/device.service';

interface Props {
  doorId: number;
  disabled?: boolean;
}

const NONE = 'none';

/**
 * The hardware at one door: exactly one proximity device and one lock.
 *
 * Presented as two fixed slots rather than a list you add to, because that is
 * what a door physically has — something that senses you approaching and
 * something that lets you in. A free list made the operator decide how many of
 * each was sensible, and the answer is always one.
 *
 * Attachment lives on the device (`devices.door_id`), not the door, because
 * hardware outlives the door it is mounted at: deleting a door leaves its
 * devices intact and unassigned rather than destroying inventory records.
 */
export default function DoorDevices({ doorId, disabled }: Props) {
  const { t } = useTranslation();
  const [attached, setAttached] = useState<Device[]>([]);
  const [free, setFree] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [mine, unassigned] = await Promise.all([
      DeviceService.forDoor(doorId),
      DeviceService.getAll({ door_id: 'none' }),
    ]);
    setAttached(mine);
    setFree(unassigned.data);
  }, [doorId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  /** Attach the chosen device to this slot, detaching whatever held it. */
  async function choose(kind: DeviceKind, value: string) {
    setBusy(true);
    try {
      const current = attached.find((d) => d.kind === kind);
      // Detach first: a door has one slot per kind, so putting a new device in
      // implies the old one comes out. Doing it in this order means a failure
      // half way leaves the door with nothing rather than with two.
      if (current) await DeviceService.update(current.id, { door_id: null });
      if (value !== NONE) await DeviceService.update(Number(value), { door_id: doorId });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const slot = (kind: DeviceKind, icon: React.ReactNode) => {
    const current = attached.find((d) => d.kind === kind);
    // Offer the unassigned devices of this kind, plus whatever is already here.
    const options = [...free.filter((d) => d.kind === kind), ...(current ? [current] : [])];

    return (
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          {icon}{t(`devices.slot.${kind}`)}
        </Label>
        <Select
          value={current ? String(current.id) : NONE}
          onValueChange={(v) => choose(kind, v)}
          disabled={disabled || busy}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('devices.slotNone')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('devices.slotNone')}</SelectItem>
            {options.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}{d.address ? ` · ${d.address}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options.length === 0 && !current && (
          <p className="text-muted-foreground text-xs">{t(`devices.slotEmpty.${kind}`)}</p>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {slot('proximity', <Radio className="h-3.5 w-3.5 text-muted-foreground" />)}
      {slot('lock', <Lock className="h-3.5 w-3.5 text-muted-foreground" />)}
    </div>
  );
}
