import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormInput, FormSelect } from '@/UI/form-fields';
import { Button } from '@/UI/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/UI/dialog';
import { DeviceService, DEVICE_KINDS, LOCK_PROFILES, type Device, type DeviceKind, type LockProfile } from '../services/device.service';
import { DoorService, type Door } from '@/components/105_doors/services/door.service';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing device, or null to create one. */
  device: Device | null;
  /** Prefilled address when adding straight from a scan result. */
  presetAddress?: string | null;
  onSaved: () => void;
}

const UNASSIGNED = 'none';

export default function DeviceForm({ open, onOpenChange, device, presetAddress, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('other');
  const [address, setAddress] = useState('');
  const [doorId, setDoorId] = useState<string>(UNASSIGNED);
  const [lockProfile, setLockProfile] = useState<LockProfile>('native_json');
  const [commandTopic, setCommandTopic] = useState('');
  const [unlockPayload, setUnlockPayload] = useState('');
  const [lockPayload, setLockPayload] = useState('');
  const [holdSeconds, setHoldSeconds] = useState('');
  const [doors, setDoors] = useState<Door[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(device?.name ?? '');
    setKind(device?.kind ?? 'other');
    setAddress(device?.address ?? presetAddress ?? '');
    setDoorId(device?.door_id ? String(device.door_id) : UNASSIGNED);
    setLockProfile((device?.lock_profile as LockProfile) ?? 'native_json');
    setCommandTopic(device?.command_topic ?? '');
    setUnlockPayload(device?.unlock_payload ?? '');
    setLockPayload(device?.lock_payload ?? '');
    setHoldSeconds(device?.hold_seconds != null ? String(device.hold_seconds) : '');
    DoorService.getAll('', null, 100).then((p) => setDoors(p.data)).catch(() => setDoors([]));
  }, [open, device, presetAddress]);

  async function save() {
    if (!name.trim()) { setError(t('devices.nameRequired')); return; }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        kind,
        // Empty string would be stored as an address of "", which reads as
        // configured-but-blank rather than genuinely unset.
        address: address.trim() || null,
        door_id: doorId === UNASSIGNED ? null : Number(doorId),
        // Actuation belongs to a lock and to nothing else. Sent as null on any
        // other kind so a beacon never looks like a lock that happens to speak
        // Tasmota — including when a device is changed from lock to something
        // else and would otherwise keep stale command fields.
        ...(kind === 'lock'
          ? {
              lock_profile: lockProfile,
              command_topic: commandTopic.trim() || null,
              unlock_payload: lockProfile === 'custom' ? unlockPayload || null : null,
              lock_payload: lockProfile === 'custom' ? lockPayload || null : null,
              hold_seconds: holdSeconds.trim() ? Number(holdSeconds) : null,
            }
          : {
              lock_profile: null,
              command_topic: null,
              unlock_payload: null,
              lock_payload: null,
              hold_seconds: null,
            }),
      };
      if (device) await DeviceService.update(device.id, body);
      else await DeviceService.create(body);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{device ? t('devices.editTitle') : t('devices.addTitle')}</DialogTitle>
          <DialogDescription>{t('devices.formHint')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <FormInput label={t('devices.fields.name')} value={name} onChange={setName} />
          <FormSelect
            label={t('devices.fields.kind')}
            value={kind}
            onChange={(v) => setKind(v as DeviceKind)}
            options={DEVICE_KINDS.map((k) => ({ value: k, label: t(`devices.kind.${k}`) }))}
          />
          <FormInput
            label={t('devices.fields.address')}
            value={address}
            onChange={setAddress}
            placeholder="doors/front-01/cmd"
          />
          <FormSelect
            label={t('devices.fields.door')}
            value={doorId}
            onChange={setDoorId}
            options={[
              { value: UNASSIGNED, label: t('devices.unassigned') },
              ...doors.map((d) => ({ value: String(d.id), label: `${d.name} (${d.door_code})` })),
            ]}
          />

          {/*
            Only a lock is actuated, so only a lock is asked how. The profile
            fills in the topic shape and payloads for common hardware; the two
            overrides exist because one install always has a relay that does not
            match its own vendor's documentation.
          */}
          {kind === 'lock' && (
            <div className="grid gap-4 rounded-md border p-3">
              <FormSelect
                label={t('devices.fields.lockProfile')}
                value={lockProfile}
                onChange={(v) => setLockProfile(v as LockProfile)}
                options={LOCK_PROFILES.map((p) => ({
                  value: p,
                  label: t(`devices.lockProfile.${p}`),
                }))}
              />
              <p className="text-muted-foreground -mt-2 text-xs">
                {t(`devices.lockProfileHint.${lockProfile}`)}
              </p>

              <FormInput
                label={t('devices.fields.holdSeconds')}
                value={holdSeconds}
                onChange={setHoldSeconds}
                placeholder="5"
              />

              {lockProfile === 'custom' && (
                <>
                  <FormInput
                    label={t('devices.fields.unlockPayload')}
                    value={unlockPayload}
                    onChange={setUnlockPayload}
                    placeholder="OPEN"
                  />
                  <FormInput
                    label={t('devices.fields.lockPayload')}
                    value={lockPayload}
                    onChange={setLockPayload}
                    placeholder="CLOSE"
                  />
                </>
              )}

              <FormInput
                label={t('devices.fields.commandTopic')}
                value={commandTopic}
                onChange={setCommandTopic}
                placeholder={t('devices.fields.commandTopicPlaceholder')}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
