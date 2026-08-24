import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Input } from '@/UI/input';
import { Label } from '@/UI/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';
import { apiFetch } from '@/lib/apiFetch';
import { UsersService, type AppUser } from '../services/users.service';

interface Building { id: number; name: string; sandboxBuildingId: number | null; }

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
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [assignedIds, setAssignedIds] = useState<number[]>([]);
  const [allBuildings, setAllBuildings] = useState(false);
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
      setAllBuildings(false);
      setAssignedIds([]);
      setError('');
    }
  }, [user]);

  useEffect(() => {
    apiFetch('/auth/buildings').then(async (res) => {
      if (res.ok) setBuildings(await res.json());
    });
    if (user) {
      UsersService.getBuildings(user.id).then(({ allBuildings: ab, buildingIds }) => {
        setAllBuildings(ab);
        setAssignedIds(buildingIds);
      }).catch(() => {});
    } else {
      setAllBuildings(false);
      setAssignedIds([]);
    }
  }, [user]);

  function toggleBuilding(id: number) {
    setAssignedIds((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isNew) {
        await UsersService.create({ email, name, role, password, allBuildings, buildingIds: allBuildings ? [] : assignedIds });
      } else {
        await UsersService.update(user.id, { name, role });
        await UsersService.setBuildings(user.id, { allBuildings, buildingIds: allBuildings ? [] : assignedIds });
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

      {buildings.length > 0 && (
        <div className="space-y-2">
          <Label>{t('users.fields.buildings')}</Label>
          <div className="space-y-1 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer font-medium border-b pb-1 mb-1">
              <input
                type="checkbox"
                checked={allBuildings}
                onChange={() => setAllBuildings((v) => !v)}
                disabled={isSuperadmin}
                className="rounded"
              />
              {t('users.fields.allBuildings')}
            </label>
            {buildings.map((b) => (
              <label key={b.id} className={`flex items-center gap-2 text-sm ${allBuildings || isSuperadmin ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={allBuildings || assignedIds.includes(b.id)}
                  onChange={() => toggleBuilding(b.id)}
                  disabled={allBuildings || isSuperadmin}
                  className="rounded"
                />
                {b.name}
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
