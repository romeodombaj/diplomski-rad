import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/UI/badge';
import { Copy } from 'lucide-react';
import type { Person, PersonStatus, PersonType } from '../services/person.service';
import type { TFunction } from 'i18next';

const STATUS_VARIANT: Record<PersonStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  invited: 'secondary',
  enrolling: 'secondary',
  active: 'default',
  suspended: 'outline',
  offboarded: 'destructive',
};

const STATUS_CLASS: Record<PersonStatus, string> = {
  invited: '',
  enrolling: '',
  active: '',
  suspended: 'border-amber-500 text-amber-600 dark:text-amber-500',
  offboarded: '',
};

function shortDid(did: string) {
  const tail = did.slice(-6);
  const head = did.length > 26 ? did.slice(0, 20) : did;
  return `${head}…${tail}`;
}

export function makeColumns(t: TFunction): ColumnDef<Person>[] {
  return [
    {
      accessorKey: 'full_name',
      header: t('person.columns.name'),
      enableSorting: true,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex flex-col">
            <span className="font-medium">{p.full_name}</span>
            {p.employee_no && (
              <span className="text-xs text-muted-foreground">{p.employee_no}</span>
            )}
          </div>
        );
      },
    },
    { accessorKey: 'department', header: t('person.columns.department'), enableSorting: true },
    {
      accessorKey: 'person_type',
      header: t('person.columns.type'),
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">{t(`person.type.${row.original.person_type as PersonType}`)}</Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: t('person.columns.status'),
      enableSorting: true,
      cell: ({ row }) => {
        const s = row.original.status;
        return (
          <Badge variant={STATUS_VARIANT[s]} className={STATUS_CLASS[s]}>
            {t(`person.status.${s}`)}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'did',
      header: t('person.columns.did'),
      cell: ({ row }) => {
        const did = row.original.did;
        if (!did) return <span className="text-muted-foreground">—</span>;
        return (
          <button
            type="button"
            title={did}
            className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard?.writeText(did);
            }}
          >
            {shortDid(did)}
            <Copy className="h-3 w-3" />
          </button>
        );
      },
    },
    {
      accessorKey: 'enrolled_at',
      header: t('person.columns.enrolled'),
      enableSorting: true,
      cell: ({ row }) => {
        const v = row.original.enrolled_at;
        return v
          ? new Date(v).toLocaleDateString()
          : <span className="text-muted-foreground">{t('person.never')}</span>;
      },
    },
  ];
}
