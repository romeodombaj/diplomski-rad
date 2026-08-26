import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormInput } from '@/UI/form-fields';
import { Button } from '@/UI/button';
import { PersonService, type Person } from '../services/person.service';

interface Props {
  id: string;
  initialData?: Person;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function EditPerson({ id, initialData, onSuccess, onCancel }: Props) {
  const { t } = useTranslation();
  const [full_name, setFullName] = useState(initialData?.full_name ?? '');
  const [employee_no, setEmployeeNo] = useState(initialData?.employee_no ?? '');
  const [email, setEmail] = useState(initialData?.email ?? '');
  const [phone, setPhone] = useState(initialData?.phone ?? '');
  const [department, setDepartment] = useState(initialData?.department ?? '');
  const [job_title, setJobTitle] = useState(initialData?.job_title ?? '');
  const [employment_end, setEmploymentEnd] = useState(initialData?.employment_end ?? '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialData) return;
    PersonService.getById(id).then((p) => {
      setFullName(p.full_name);
      setEmployeeNo(p.employee_no ?? '');
      setEmail(p.email ?? '');
      setPhone(p.phone ?? '');
      setDepartment(p.department ?? '');
      setJobTitle(p.job_title ?? '');
      setEmploymentEnd(p.employment_end ?? '');
    });
  }, [id, initialData]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await PersonService.update(id, {
        full_name,
        employee_no: employee_no || null,
        email: email || null,
        phone: phone || null,
        department: department || null,
        job_title: job_title || null,
        employment_end: employment_end || null,
      });
      onSuccess?.();
    } catch (err: any) {
      if (err?.fields) setErrors(err.fields);
      else setErrors({ full_name: err?.message ?? 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="mx-auto w-full max-w-[720px] px-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4">
        <FormInput label={t('person.fields.fullName')} value={full_name} onChange={setFullName} error={errors.full_name} />
        <FormInput label={t('person.fields.employeeNo')} value={employee_no} onChange={setEmployeeNo} error={errors.employee_no} />
        <FormInput label={t('person.fields.department')} value={department} onChange={setDepartment} error={errors.department} />
        <FormInput label={t('person.fields.jobTitle')} value={job_title} onChange={setJobTitle} error={errors.job_title} />
        <FormInput label={t('person.fields.email')} value={email} onChange={setEmail} error={errors.email} />
        <FormInput label={t('person.fields.phone')} value={phone} onChange={setPhone} error={errors.phone} />
        <FormInput label={t('person.fields.employmentEnd')} value={employment_end} onChange={setEmploymentEnd} error={errors.employment_end} placeholder="YYYY-MM-DD" />
      </div>
      {/* person_type and status are deliberately absent: type is immutable and
          status moves only through the lifecycle actions, so each transition
          keeps its own audit point. */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <Button type="button" variant="outline" className="w-full" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving} className="w-full">{saving ? t('common.saving') : t('common.save')}</Button>
      </div>
    </form>
  );
}
