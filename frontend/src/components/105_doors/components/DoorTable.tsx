import { useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import { Plus, RefreshCw, X, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/UI/sheet';
import NewDoor from '../door/NewDoor';
import EditDoor from '../door/EditDoor';
import DoorAccessDialog from '../door/DoorAccessDialog';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { DataTable } from '../components/DataTable';
import { columns } from '../components/columns';
import { useDoor } from '../hooks/useDoor';
import UnlockButton from './UnlockButton';
import { DoorService, type Door as DoorType } from '../services/door.service';
import { SearchInput } from '@/UI/SearchInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/UI/alert-dialog';

export default function DoorTable() {
  const navigate = useNavigate();
  const [accessDoor, setAccessDoor] = useState<DoorType | null>(null);
  const { t } = useTranslation();
  const { data, loading, error, remove, refresh, search, setSearch, filters, setFilter, clearFilters, sortField, sortDir, setSort, page, nextPage, prevPage, hasMore, total } = useDoor();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editData] = useState<DoorType | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastRefreshRef = useRef(0);

  const handleRefresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    const now = Date.now();
    if (now - lastRefreshRef.current >= 3000) {
      lastRefreshRef.current = now;
      refresh();
    }
    setTimeout(() => setIsRefreshing(false), 800);
  };


  async function handleExport(format: 'csv' | 'xlsx') {
    const all = await DoorService.exportAll(filters, sortField, sortDir);
    const rows = all.data as Record<string, unknown>[];
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    if (format === 'csv') {
      const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'doors.csv';
      a.click();
    } else {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'doors');
      XLSX.writeFile(wb, 'doors.xlsx');
    }
  }

  return (
    <>
      {/* Toolbar: search, filters, actions */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('common.search')}</span>
            <SearchInput key={resetKey} onSearch={setSearch} isLoading={loading && search !== ''} placeholder={t('door.searchPlaceholder')} className="w-64" minLength={2} active={search !== ''} />
          </div>
          {/* Filter: active */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('door.filter_active')}</span>
            <Select value={filters['active'] ?? 'all'} onValueChange={(v) => setFilter('active', v === 'all' ? '' : v)}>
              <SelectTrigger className={`w-40${filters['active'] ? ' border-primary' : ''}`}>
                <SelectValue placeholder={t('door.filter_active')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="true">{t('common.true')}</SelectItem>
                <SelectItem value="false">{t('common.false')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Clear all filters */}
          {(Object.keys(filters).length > 0 || search !== '') && (
            <Button variant="ghost" size="sm" className="text-muted-foreground self-end" onClick={() => { clearFilters(); setSearch(''); setResetKey((k) => k + 1); }}>
              <X className="h-4 w-4 mr-1" />
              {t('common.clearAll')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* New door — opens slide */}
          <Button variant="default" size="sm" onClick={() => { setEditId(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('common.new')}
          </Button>
          {/* Refresh with 3s throttle */}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2${isRefreshing ? ' animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Data table */}
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        onExport={handleExport}
        onCreate={search === '' && Object.keys(filters).length === 0 ? () => { setEditId(null); setFormOpen(true); } : undefined}
        hasActiveFilters={search !== '' || Object.keys(filters).length > 0}
        onView={(row) => navigate(`/doors/${(row as DoorType).id}`)}
        onEdit={(row) => navigate(`/doors/${(row as DoorType).id}`)}
        rowActions={(row: unknown) => {
          const d = row as DoorType;
          return (
            // Row clicks open the door page, so both controls stop propagation
            // — a mis-aimed click must never open a door.
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <UnlockButton door={d} variant="ghost" />
              <Button
                variant="ghost" size="sm" title={t('doors.access.button')}
                onClick={(e) => { e.stopPropagation(); setAccessDoor(d); }}
              >
                <Users className="h-4 w-4" />
              </Button>
            </div>
          );
        }}
        onDelete={(row) => setDeleteId(row.id as number)}
        page={page}
        hasMore={hasMore}
        total={total}
        onNext={nextPage}
        onPrev={prevPage}
        sortField={sortField}
        sortDir={sortDir}
        onSort={setSort}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.areYouSure')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('common.actionCannotBeUndone')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { remove(deleteId!); setDeleteId(null); }}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New / Edit door slide */}
      <DoorAccessDialog
        doorId={accessDoor?.id ?? null}
        doorName={accessDoor?.name}
        open={accessDoor !== null}
        onOpenChange={(o) => { if (!o) setAccessDoor(null); }}
      />

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editId !== null ? t('door.editSheet') : t('door.newSheet')}</SheetTitle>
          </SheetHeader>
          {editId !== null
            ? <EditDoor id={String(editId)} initialData={editData ?? undefined} onSuccess={() => { setFormOpen(false); refresh(); }} />
            : <NewDoor onSuccess={() => { setFormOpen(false); refresh(); }} />
          }
        </SheetContent>
      </Sheet>
    </>
  );
}
