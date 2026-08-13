import { useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/UI/sheet';
import AuditLog from '../auditLog/AuditLog';
import { type AuditLog as AuditLogType } from '../services/auditLog.service';
import { Button } from '@/UI/button';
import { DataTable } from '../components/DataTable';
import { useAuditLogColumns } from '../components/columns';
import { useAuditLog } from '../hooks/useAuditLog';
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

export default function AuditLogTable() {
  const { t } = useTranslation();
  const columns = useAuditLogColumns();
  const { data, loading, error, remove, refresh, search, setSearch, filters, setFilter, clearFilters, sortField, sortDir, setSort, page, nextPage, prevPage, hasMore, total } = useAuditLog();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
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

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('auditLog.search')}</span>
            <SearchInput key={resetKey} onSearch={setSearch} isLoading={loading && search !== ''} placeholder={t('auditLog.searchPlaceholder')} className="w-64" minLength={2} active={search !== ''} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('auditLog.action')}</span>
            <Select value={filters['action'] ?? 'all'} onValueChange={(v) => setFilter('action', v === 'all' ? '' : v)}>
              <SelectTrigger className={`w-40${filters['action'] && filters['action'] !== 'all' ? ' border-primary' : ''}`}>
                <SelectValue placeholder={t('auditLog.action')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('auditLog.all')}</SelectItem>
                <SelectItem value="create">{t('auditLog.create')}</SelectItem>
                <SelectItem value="update">{t('auditLog.update')}</SelectItem>
                <SelectItem value="delete">{t('auditLog.delete')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(Object.keys(filters).length > 0 || search !== '') && (
            <Button variant="ghost" size="sm" className="text-muted-foreground self-end" onClick={() => { clearFilters(); setSearch(''); setResetKey((k) => k + 1); }}>
              <X className="h-4 w-4 mr-1" />
              {t('auditLog.clearAll')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2${isRefreshing ? ' animate-spin' : ''}`} />
            {t('auditLog.refresh')}
          </Button>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        error={error}
        onRetry={refresh}
        hasActiveFilters={search !== '' || Object.keys(filters).length > 0}
        onEdit={(row) => { setEditId((row as AuditLogType).id as number); setFormOpen(true); }}
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
            <AlertDialogTitle>{t('auditLog.areYouSure')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('auditLog.actionCannotBeUndone')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('auditLog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { remove(deleteId!); setDeleteId(null); }}>
              {t('auditLog.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editId !== null ? t('auditLog.editSheet') : t('auditLog.newSheet')}</SheetTitle>
          </SheetHeader>
          <AuditLog id={editId !== null ? String(editId) : undefined} onSuccess={() => { setFormOpen(false); refresh(); }} />
        </SheetContent>
      </Sheet>
    </>
  );
}
