import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Input } from '@/UI/input';
import { Label } from '@/UI/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';
import { apiFetch } from '@/lib/apiFetch';
import { UsersService, type AppUser } from '../services/users.service';

interface Project { id: string; name: string; sandboxProjectId: string | null; }

interface Props {
  user: AppUser | null;
  onSuccess: () => void;
}

export default function UserForm({ user, onSuccess }: Props) {
  const { t } = useTranslation();
  const isNew = user === null;

  const [name, setName] = useState(() => user?.name ?? '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(() => user?.role ?? 'user');
  const [password, setPassword] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setPassword('');
      setError('');
    } else {
      setName('');
      setEmail('');
      setRole('user');
      setPassword('');
      setAllProjects(false);
      setAssignedIds([]);
      setError('');
    }
  }, [user]);

  useEffect(() => {
    apiFetch('/auth/projects').then(async (res) => {
      if (res.ok) setProjects(await res.json());
    });
    if (user) {
      UsersService.getProjects(user.id).then(({ allProjects: ap, projectIds }) => {
        setAllProjects(ap);
        setAssignedIds(projectIds);
      }).catch(() => {});
    } else {
      setAllProjects(false);
      setAssignedIds([]);
    }
  }, [user]);

  function toggleProject(id: string) {
    setAssignedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isNew) {
        await UsersService.create({ email, name, role, password, allProjects, projectIds: allProjects ? [] : assignedIds });
      } else {
        await UsersService.update(user.id, { name, role });
        await UsersService.setProjects(user.id, { allProjects, projectIds: allProjects ? [] : assignedIds });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const isSuperadmin = user?.role === 'superadmin';

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      {isNew && (
        <div className="space-y-1">
          <Label htmlFor="uf-email">{t('users.fields.email')}</Label>
          <Input
            id="uf-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
          />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="uf-name">{t('users.fields.name')}</Label>
        <Input
          id="uf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('users.fields.name')}
          required
          disabled={isSuperadmin}
        />
      </div>

      <div className="space-y-1">
        <Label>{t('users.fields.role')}</Label>
        <Select value={role} onValueChange={setRole} disabled={isSuperadmin}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">{t('users.roles.user')}</SelectItem>
            <SelectItem value="admin">{t('users.roles.admin')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isNew && (
        <div className="space-y-1">
          <Label htmlFor="uf-password">{t('users.fields.password')}</Label>
          <Input
            id="uf-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('users.fields.password')}
            minLength={6}
            required
          />
        </div>
      )}

      {projects.length > 0 && (
        <div className="space-y-2">
          <Label>{t('users.fields.projects')}</Label>
          <div className="space-y-1 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer font-medium border-b pb-1 mb-1">
              <input
                type="checkbox"
                checked={allProjects}
                onChange={() => setAllProjects((v) => !v)}
                disabled={isSuperadmin}
                className="rounded"
              />
              {t('users.fields.allProjects')}
            </label>
            {projects.map((p) => (
              <label key={p.id} className={`flex items-center gap-2 text-sm ${allProjects || isSuperadmin ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={allProjects || assignedIds.includes(p.id)}
                  onChange={() => toggleProject(p.id)}
                  disabled={allProjects || isSuperadmin}
                  className="rounded"
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!isSuperadmin && (
        <Button type="submit" disabled={saving} className="w-full">
          {saving
            ? isNew ? t('common.creating') : t('common.saving')
            : isNew ? t('common.create') : t('common.save')}
        </Button>
      )}
    </form>
  );
}
