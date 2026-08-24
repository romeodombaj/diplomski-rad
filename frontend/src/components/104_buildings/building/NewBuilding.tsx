import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FormInput } from '@/UI/form-fields';
import { Button } from '@/UI/button';
import { BuildingService } from '../services/building.service';

interface Props {
  onSuccess?: () => void;
}

export default function NewBuilding({ onSuccess }: Props = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contract_address, setContract_address] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await BuildingService.create({ name, address, contract_address });
      onSuccess ? onSuccess() : navigate('/buildings');
    } catch (err: any) {
      if (err?.fields) setErrors(err.fields);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="building-form" onSubmit={handleCreate} className="mx-auto w-full max-w-[720px] px-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4">
        <FormInput label="Name" value={name} onChange={setName} error={errors.name} />
        <FormInput label="Address" value={address} onChange={setAddress} error={errors.address} />
        <FormInput label="Contract address" value={contract_address} onChange={setContract_address} error={errors.contract_address} />
      </div>
      <div className="grid grid-cols-2 gap-4 mt-6">
        <Button type="button" variant="outline" className="w-full" onClick={() => onSuccess ? onSuccess() : navigate('/buildings')}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving} className="w-full">{saving ? t('common.creating') : t('common.create')}</Button>
      </div>
    </form>
  );
}
