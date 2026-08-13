import { useRef, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/UI/sheet';
import { Button } from '@/UI/button';
import { DataTable } from '../../101_AuditLogs/components/DataTable';
import { useUsersColumns } from './columns';
import { useUsers } from '../hooks/useUsers';
import { SearchInput } from '@/UI/SearchInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/UI/alert-dialog';
import UserForm from '../user/UserForm';
import type { AppUser } from '../services/users.service';

export default function UsersTable() {
  const { t } = useTranslation();
  const columns = useUsersColumns();
  const { data, loading, error, refresh, remove } = useUsers();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastRefreshRef = useRef(0);

  const handleRefresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    const now = Date.now();
    if (now - lastRefreshRef.current >= 3000) { lastRefreshRef.current = now; refresh(); }
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const filtered = data.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesRole = !roleFilter || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const hasFilters = search !== '' || roleFilter !== '';

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('common.search')}</span>
            <SearchInput
              key={resetKey}
              onSearch={setSearch}
              isLoading={false}
              placeholder={t('users.searchPlaceholder')}
              className="w-64"
              minLength={1}
              active={search !== ''}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('users.columns.role')}</span>
            <Select value={roleFilter || 'all'} onValueChange={(v) => setRoleFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className={`w-36${roleFilter ? ' border-primary' : ''}`}>
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="user">{t('users.roles.user')}</SelectItem>
                <SelectItem value="admin">{t('users.roles.admin')}</SelectItem>
                <SelectItem value="superadmin">{t('users.roles.superadmin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground self-end"
              onClick={() => { setRoleFilter(''); setSearch(''); setResetKey((k) => k + 1); }}
            >
              <X className="h-4 w-4 mr-1" />{t('common.clearAll')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2${isRefreshing ? ' animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={() => { setEditUser(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />{t('common.new')}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        error={error}
        onRetry={refresh}
        hasActiveFilters={hasFilters}
        onEdit={(row) => { setEditUser(row as AppUser); setFormOpen(true); }}
        onDelete={(row) => {
          const u = row as AppUser;
          if (u.role === 'superadmin') return;
          setDeleteId(u.id);
        }}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.areYouSure')}</AlertDialogTitle>
            <AlertDialogDescription>{t('common.actionCannotBeUndone')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { remove(deleteId!); setDeleteId(null); }}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editUser ? t('users.editSheet') : t('users.newSheet')}</SheetTitle>
          </SheetHeader>
          <UserForm key={editUser?.id ?? 'new'} user={editUser} onSuccess={() => { setFormOpen(false); refresh(); }} />
        </SheetContent>
      </Sheet>
    </>
  );
}
