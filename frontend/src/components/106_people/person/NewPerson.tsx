import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormInput, FormSelect, FormSuggestInput } from '@/UI/form-fields';
import { Button } from '@/UI/button';
import { PersonService, type EnrollmentInvite, type PersonType } from '../services/person.service';

interface Props {
  onSuccess?: (invite: EnrollmentInvite, name: string, personId: string) => void;
  onCancel?: () => void;
}

const TYPES: PersonType[] = ['employee', 'contractor', 'visitor', 'service'];

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function NewPerson({ onSuccess, onCancel }: Props = {}) {
  const { t } = useTranslation();
  const [full_name, setFullName] = useState('');
  const [employee_no, setEmployeeNo] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [job_title, setJobTitle] = useState('');
  const [person_type, setPersonType] = useState<PersonType>('employee');
  const [employment_start, setEmploymentStart] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [departments, setDepartments] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    PersonService.getAll('', null, 200)
      .then((page) => {
        if (cancelled) return;
        const seen = new Map<string, string>();
        for (const p of page.data) {
          const d = p.department?.trim();
          if (d && !seen.has(d.toLowerCase())) seen.set(d.toLowerCase(), d);
        }
        setDepartments([...seen.values()].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await PersonService.create({
        full_name,
        employee_no: employee_no || null,
        email: email || null,
        phone: phone || null,
        department: department || null,
        job_title: job_title || null,
        person_type,
        employment_start: employment_start || null,
      });
      onSuccess?.(res.invite, res.person.full_name, res.person.id);
    } catch (err: any) {
      if (err?.fields) setErrors(err.fields);
      else setErrors({ full_name: err?.message ?? 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="mx-auto w-full max-w-[720px] px-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4">
        <FormInput label={t('person.fields.fullName')} value={full_name} onChange={setFullName} error={errors.full_name} />
        <FormInput label={t('person.fields.employeeNo')} value={employee_no} onChange={setEmployeeNo} error={errors.employee_no} />
        <FormSelect
          label={t('person.fields.type')}
          value={person_type}
          onChange={(v) => setPersonType(v as PersonType)}
          options={TYPES.map((v) => ({ value: v, label: t(`person.type.${v}`) }))}
          error={errors.person_type}
        />
        <FormSuggestInput
          label={t('person.fields.department')}
          value={department}
          onChange={setDepartment}
          options={departments}
          error={errors.department}
        />
        <FormInput label={t('person.fields.jobTitle')} value={job_title} onChange={setJobTitle} error={errors.job_title} />
        <FormInput label={t('person.fields.email')} value={email} onChange={setEmail} error={errors.email} />
        <FormInput label={t('person.fields.phone')} value={phone} onChange={setPhone} error={errors.phone} />
        <FormInput
          type="date"
          label={t('person.fields.employmentStart')}
          value={employment_start}
          onChange={setEmploymentStart}
          error={errors.employment_start}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-4">{t('person.createHint')}</p>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <Button type="button" variant="outline" className="w-full" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving} className="w-full">{saving ? t('common.creating') : t('common.create')}</Button>
      </div>
    </form>
  );
}
