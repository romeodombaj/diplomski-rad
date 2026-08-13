import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/UI/badge';
import type { AppUser } from '../services/users.service';

export function useUsersColumns(): ColumnDef<AppUser>[] {
  const { t } = useTranslation();
  return [
    {
      accessorKey: 'name',
      header: t('users.columns.name'),
    },
    {
      accessorKey: 'email',
      header: t('users.columns.email'),
    },
    {
      accessorKey: 'role',
      header: t('users.columns.role'),
      cell: ({ row }) => {
        const role = row.original.role;
        const variant =
          role === 'superadmin' ? 'destructive' : role === 'admin' ? 'default' : 'secondary';
        return <Badge variant={variant}>{t(`users.roles.${role}`, { defaultValue: role })}</Badge>;
      },
    },
    {
      accessorKey: 'created_at',
      header: t('users.columns.createdAt'),
      cell: ({ row }) => new Date(row.original.created_at).toLocaleDateString(),
    },
  ];
}
