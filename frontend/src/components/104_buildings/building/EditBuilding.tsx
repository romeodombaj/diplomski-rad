import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FormInput } from '@/UI/form-fields';
import { Skeleton } from '@/UI/skeleton';
import { Button } from '@/UI/button';
import { BuildingService, type Building as BuildingType } from '../services/building.service';

interface Props {
  id?: string;
  initialData?: BuildingType;
  onSuccess?: () => void;
  readOnly?: boolean;
}

export default function EditBuilding({ id: propId, initialData, onSuccess, readOnly }: Props = {}) {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = propId ?? params.id;
  const navigate = useNavigate();
  const [name, setName] = useState(String(initialData?.name ?? ''));
  const [address, setAddress] = useState(String(initialData?.address ?? ''));
  const [contract_address, setContract_address] = useState(String(initialData?.contract_address ?? ''));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!initialData && !!id);

  useEffect(() => {
    if (!id || initialData) return;
    setLoading(true);
    BuildingService.getById(Number(id))
      .then((data) => {
        setName(String(data.name ?? ''));
        setAddress(String(data.address ?? ''));
        setContract_address(String(data.contract_address ?? ''));
      })
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await BuildingService.update(Number(id), { name, address, contract_address });
      onSuccess ? onSuccess() : navigate('/buildings');
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
          <p className="text-xs text-muted-foreground">Address</p>
          <p className="text-sm font-medium">{address || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('building.contractAddress')}</p>
          <p className="text-sm font-medium">{contract_address || '—'}</p>
        </div>
      </div>
    </div>
  );

  return (
    <form id="building-form" onSubmit={handleSave} className="mx-auto w-full max-w-[720px] px-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4">
        <FormInput label="Name" value={name} onChange={setName} disabled={saving} error={errors.name} />
        <FormInput label="Address" value={address} onChange={setAddress} disabled={saving} error={errors.address} />
        <FormInput label="Contract address" value={contract_address} onChange={setContract_address} disabled={saving} error={errors.contract_address} />
      </div>
      <div className="grid grid-cols-2 gap-4 mt-6">
        <Button type="button" variant="outline" className="w-full" onClick={() => onSuccess ? onSuccess() : navigate('/buildings')}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving} className="w-full">{saving ? t('common.saving') : t('common.save')}</Button>
      </div>
    </form>
  );
}
