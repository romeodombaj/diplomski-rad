import { useRef, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/UI/sheet';
import NewBuilding from '../building/NewBuilding';
import EditBuilding from '../building/EditBuilding';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { DataTable } from '../components/DataTable';
import { columns } from '../components/columns';
import { useBuilding } from '../hooks/useBuilding';
import { BuildingService, type Building as BuildingType } from '../services/building.service';
import { SearchInput } from '@/UI/SearchInput';
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

export default function BuildingTable() {
  const { t } = useTranslation();
  const { data, loading, error, remove, refresh, search, setSearch, filters, clearFilters, sortField, sortDir, setSort, page, nextPage, prevPage, hasMore, total } = useBuilding();

  async function handleViewDoors(building: BuildingType) {
    const res = await fetch('/auth/switch-building', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: building.id }),
    });
    if (res.ok) window.location.href = '/doors';
  }
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<BuildingType | null>(null);
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
    const all = await BuildingService.exportAll(filters, sortField, sortDir);
    const rows = all.data as Record<string, unknown>[];
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    if (format === 'csv') {
      const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'buildings.csv';
      a.click();
    } else {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'buildings');
      XLSX.writeFile(wb, 'buildings.xlsx');
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('common.search')}</span>
            <SearchInput key={resetKey} onSearch={setSearch} isLoading={loading && search !== ''} placeholder={t('building.searchPlaceholder')} className="w-64" minLength={2} active={search !== ''} />
          </div>
          {(Object.keys(filters).length > 0 || search !== '') && (
            <Button variant="ghost" size="sm" className="text-muted-foreground self-end" onClick={() => { clearFilters(); setSearch(''); setResetKey((k) => k + 1); }}>
              <X className="h-4 w-4 mr-1" />
              {t('common.clearAll')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={() => { setEditId(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('common.new')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2${isRefreshing ? ' animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        onExport={handleExport}
        onCreate={search === '' && Object.keys(filters).length === 0 ? () => { setEditId(null); setFormOpen(true); } : undefined}
        hasActiveFilters={search !== '' || Object.keys(filters).length > 0}
        onView={(row) => handleViewDoors(row as BuildingType)}
        onEdit={(row) => { setEditId((row as BuildingType).id as number); setEditData(row as BuildingType); setFormOpen(true); }}
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

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editId !== null ? t('building.editSheet') : t('building.newSheet')}</SheetTitle>
          </SheetHeader>
          {editId !== null
            ? <EditBuilding id={String(editId)} initialData={editData ?? undefined} onSuccess={() => { setFormOpen(false); refresh(); }} />
            : <NewBuilding onSuccess={() => { setFormOpen(false); refresh(); }} />
          }
        </SheetContent>
      </Sheet>
    </>
  );
}
