import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FormCheckbox, FormInput } from '@/UI/form-fields';
import { Skeleton } from '@/UI/skeleton';
import { Button } from '@/UI/button';
import { DoorService, type Door as DoorType } from '../services/door.service';

interface Props {
  id?: string;
  initialData?: DoorType;
  onSuccess?: () => void;
  readOnly?: boolean;
}

export default function EditDoor({ id: propId, initialData, onSuccess, readOnly }: Props = {}) {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = propId ?? params.id;
  const navigate = useNavigate();
  const [name, setName] = useState(String(initialData?.name ?? ''));
  const [door_code, setDoor_code] = useState(String(initialData?.door_code ?? ''));
  const [mqtt_topic, setMqtt_topic] = useState(String(initialData?.mqtt_topic ?? ''));
  const [active, setActive] = useState<boolean>(Boolean(initialData?.active));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!initialData && !!id);

  useEffect(() => {
    if (!id || initialData) return;
    setLoading(true);
    DoorService.getById(Number(id))
      .then((data) => {
        setName(String(data.name ?? ''));
        setDoor_code(String(data.door_code ?? ''));
        setMqtt_topic(String(data.mqtt_topic ?? ''));
        setActive(Boolean(data.active));
      })
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await DoorService.update(Number(id), { name, door_code, mqtt_topic, active });
      onSuccess ? onSuccess() : navigate('/doors');
    } catch (err: any) {
      if (err?.fields) setErrors(err.fields);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-2">
      <div className="grid grid-cols-1 gap-x-6 gap-y-6">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
      </div>
    </div>
  );

  if (readOnly) return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-2">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Name</p>
          <p className="text-sm font-medium">{name || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Door_code</p>
          <p className="text-sm font-medium">{door_code || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Mqtt_topic</p>
          <p className="text-sm font-medium">{mqtt_topic || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-sm font-medium">{active ? t('common.true') : t('common.false')}</p>
        </div>
      </div>
    </div>
  );

  return (
    <form id="door-form" onSubmit={handleSave} className="mx-auto w-full max-w-[720px] px-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4">
        <FormInput label="Name" value={name} onChange={setName} disabled={saving} error={errors.name} />
        <FormInput label="Door_code" value={door_code} onChange={setDoor_code} disabled={saving} error={errors.door_code} />
        <FormInput label="Mqtt_topic" value={mqtt_topic} onChange={setMqtt_topic} disabled={saving} error={errors.mqtt_topic} />
        <FormCheckbox label="Active" checked={active} onChange={setActive} disabled={saving} error={errors.active} />
      </div>
      <div className="grid grid-cols-2 gap-4 mt-6">
        <Button type="button" variant="outline" className="w-full" onClick={() => onSuccess ? onSuccess() : navigate('/doors')}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving} className="w-full">{saving ? t('common.saving') : t('common.save')}</Button>
      </div>
    </form>
  );
}
