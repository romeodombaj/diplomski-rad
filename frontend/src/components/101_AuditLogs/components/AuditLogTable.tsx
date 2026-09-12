import { useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { DataTable } from '../components/DataTable';
import { useAuditLogColumns } from '../components/columns';
import { useAuditLog } from '../hooks/useAuditLog';
import { SearchInput } from '@/UI/SearchInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';

export default function AuditLogTable() {
  const { t } = useTranslation();
  const columns = useAuditLogColumns();
  const { data, loading, error, refresh, search, setSearch, filters, setFilter, clearFilters, sortField, sortDir, setSort, page, nextPage, prevPage, hasMore, total } = useAuditLog();
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
            <span className="text-xs text-muted-foreground">{t('auditLog.decision')}</span>
            <Select value={filters['decision'] ?? 'all'} onValueChange={(v) => setFilter('decision', v === 'all' ? '' : v)}>
              <SelectTrigger className={`w-40${filters['decision'] && filters['decision'] !== 'all' ? ' border-primary' : ''}`}>
                <SelectValue placeholder={t('auditLog.decision')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('auditLog.all')}</SelectItem>
                <SelectItem value="granted">{t('auditLog.granted')}</SelectItem>
                <SelectItem value="denied">{t('auditLog.denied')}</SelectItem>
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
        page={page}
        hasMore={hasMore}
        total={total}
        onNext={nextPage}
        onPrev={prevPage}
        sortField={sortField}
        sortDir={sortDir}
        onSort={setSort}
      />

    </>
  );
}
