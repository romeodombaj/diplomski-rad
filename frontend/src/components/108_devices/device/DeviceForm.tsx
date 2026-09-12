import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormInput, FormSelect } from '@/UI/form-fields';
import { Button } from '@/UI/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/UI/dialog';
import { DeviceService, DEVICE_KINDS, LOCK_PROFILES, type Device, type DeviceKind, type LockProfile } from '../services/device.service';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: Device | null;
  presetAddress?: string | null;
  onSaved: () => void;
}

export default function DeviceForm({ open, onOpenChange, device, presetAddress, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('proximity');
  const [address, setAddress] = useState('');
  const [lockProfile, setLockProfile] = useState<LockProfile>('native_json');
  const [commandTopic, setCommandTopic] = useState('');
  const [unlockPayload, setUnlockPayload] = useState('');
  const [lockPayload, setLockPayload] = useState('');
  const [holdSeconds, setHoldSeconds] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(device?.name ?? '');
    setKind(device?.kind ?? 'proximity');
    setAddress(device?.address ?? presetAddress ?? '');
    setLockProfile((device?.lock_profile as LockProfile) ?? 'native_json');
    setCommandTopic(device?.command_topic ?? '');
    setUnlockPayload(device?.unlock_payload ?? '');
    setLockPayload(device?.lock_payload ?? '');
    setHoldSeconds(device?.hold_seconds != null ? String(device.hold_seconds) : '');
  }, [open, device, presetAddress]);

  async function save() {
    if (!name.trim()) { setError(t('devices.nameRequired')); return; }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        kind,
        address: address.trim() || null,
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

          {
}
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

          {
}
          <p className="text-muted-foreground text-xs">{t('devices.attachHint')}</p>

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
