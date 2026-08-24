import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FormCheckbox, FormInput } from '@/UI/form-fields';
import { Button } from '@/UI/button';
import { DoorService } from '../services/door.service';

interface Props {
  onSuccess?: () => void;
}

export default function NewDoor({ onSuccess }: Props = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [door_code, setDoor_code] = useState('');
  const [mqtt_topic, setMqtt_topic] = useState('');
  const [active, setActive] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await DoorService.create({ name, door_code, mqtt_topic, active });
      onSuccess ? onSuccess() : navigate('/doors');
    } catch (err: any) {
      if (err?.fields) setErrors(err.fields);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="door-form" onSubmit={handleCreate} className="mx-auto w-full max-w-[720px] px-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4">
        <FormInput label="Name" value={name} onChange={setName} error={errors.name} />
        <FormInput label="Door_code" value={door_code} onChange={setDoor_code} error={errors.door_code} />
        <FormInput label="Mqtt_topic" value={mqtt_topic} onChange={setMqtt_topic} error={errors.mqtt_topic} />
        <FormCheckbox label="Active" checked={active} onChange={setActive} error={errors.active} />
      </div>
      <div className="grid grid-cols-2 gap-4 mt-6">
        <Button type="button" variant="outline" className="w-full" onClick={() => onSuccess ? onSuccess() : navigate('/doors')}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving} className="w-full">{saving ? t('common.creating') : t('common.create')}</Button>
      </div>
    </form>
  );
}
