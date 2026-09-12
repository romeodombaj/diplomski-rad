import { useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, X, QrCode, Ban, Undo2, UserMinus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/UI/sheet';
import { Button } from '@/UI/button';
import { SearchInput } from '@/UI/SearchInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/UI/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/UI/alert-dialog';
import { useNavigate } from 'react-router-dom';
import { DataTable } from './DataTable';
import { makeColumns } from './columns';
import { usePerson } from '../hooks/usePerson';
import NewPerson from '../person/NewPerson';
import EditPerson from '../person/EditPerson';
import EnrollmentDialog from '../person/EnrollmentDialog';
import { PersonService, type EnrollmentInvite, type Person } from '../services/person.service';

const STATUSES = ['invited', 'active', 'suspended', 'offboarded'] as const;
const TYPES = ['employee', 'contractor', 'visitor', 'service'] as const;

export default function PeopleTable() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    data, loading, error, refresh, search, setSearch, filters, setFilter,
    clearFilters, sortField, sortDir, setSort, page, nextPage, prevPage, hasMore, total,
  } = usePerson();

  const columns = useMemo(() => makeColumns(t), [t]);

  const [formOpen, setFormOpen] = useState(false);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [offboardTarget, setOffboardTarget] = useState<Person | null>(null);
  const [enroll, setEnroll] = useState<{ invite: EnrollmentInvite | null; name: string; id: string } | null>(null);
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

  const pendingEnrollment = data.filter((p) => p.status === 'invited').length;

  async function handleExport(format: 'csv' | 'xlsx') {
    const all = await PersonService.exportAll(filters, sortField, sortDir);
    const rows = all.data as unknown as Record<string, unknown>[];
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    if (format === 'csv') {
      const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'people.csv';
      a.click();
    } else {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'people');
      XLSX.writeFile(wb, 'people.xlsx');
    }
  }

  async function runAction(fn: () => Promise<unknown>) {
    await fn();
    refresh();
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('common.search')}</span>
            <SearchInput key={resetKey} onSearch={setSearch} isLoading={loading && search !== ''} placeholder={t('person.searchPlaceholder')} className="w-64" minLength={2} active={search !== ''} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('person.columns.status')}</span>
            <Select value={filters['status'] ?? 'all'} onValueChange={(v) => setFilter('status', v === 'all' ? '' : v)}>
              <SelectTrigger className={`w-40${filters['status'] ? ' border-primary' : ''}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`person.status.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('person.columns.type')}</span>
            <Select value={filters['person_type'] ?? 'all'} onValueChange={(v) => setFilter('person_type', v === 'all' ? '' : v)}>
              <SelectTrigger className={`w-40${filters['person_type'] ? ' border-primary' : ''}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {TYPES.map((s) => <SelectItem key={s} value={s}>{t(`person.type.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(Object.keys(filters).length > 0 || search !== '') && (
            <Button variant="ghost" size="sm" className="text-muted-foreground self-end" onClick={() => { clearFilters(); setSearch(''); setResetKey((k) => k + 1); }}>
              <X className="h-4 w-4 mr-1" />
              {t('common.clearAll')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={() => { setEditPerson(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('person.addPerson')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2${isRefreshing ? ' animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {pendingEnrollment > 0 && !filters['status'] && (
        <button
          type="button"
          onClick={() => setFilter('status', 'invited')}
          className="mb-4 w-full rounded-md border border-dashed px-4 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50"
        >
          {t('person.pendingBanner', { count: pendingEnrollment })}
        </button>
      )}

      <DataTable
        columns={columns as never}
        data={data as never}
        loading={loading}
        error={error}
        onRetry={refresh}
        onExport={handleExport}
        onCreate={search === '' && Object.keys(filters).length === 0 ? () => { setEditPerson(null); setFormOpen(true); } : undefined}
        hasActiveFilters={search !== '' || Object.keys(filters).length > 0}
        onView={(row) => navigate(`/people/${(row as unknown as Person).id}`)}
        onEdit={(row) => { setEditPerson(row as unknown as Person); setFormOpen(true); }}
        onDelete={(row) => setOffboardTarget(row as unknown as Person)}
        rowActions={(row: unknown) => {
          const p = row as Person;
          return (
            <div className="flex items-center gap-1">
              {!p.did && p.status !== 'offboarded' && (
                <Button
                  variant="ghost" size="sm" title={t('enrollment.showQr')}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const invite = await PersonService.issueEnrollment(p.id);
                    setEnroll({ invite, name: p.full_name, id: p.id });
                  }}
                >
                  <QrCode className="h-4 w-4" />
                </Button>
              )}
              {p.status === 'active' && (
                <Button variant="ghost" size="sm" title={t('person.suspend')}
                  onClick={(e) => { e.stopPropagation(); runAction(() => PersonService.suspend(p.id)); }}>
                  <Ban className="h-4 w-4" />
                </Button>
              )}
              {p.status === 'suspended' && (
                <Button variant="ghost" size="sm" title={t('person.reinstate')}
                  onClick={(e) => { e.stopPropagation(); runAction(() => PersonService.reinstate(p.id)); }}>
                  <Undo2 className="h-4 w-4" />
                </Button>
              )}
              {p.status !== 'offboarded' && (
                <Button variant="ghost" size="sm" title={t('person.offboard')}
                  onClick={(e) => { e.stopPropagation(); setOffboardTarget(p); }}>
                  <UserMinus className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        }}
        page={page}
        hasMore={hasMore}
        total={total}
        onNext={nextPage}
        onPrev={prevPage}
        sortField={sortField}
        sortDir={sortDir}
        onSort={setSort}
      />

      <AlertDialog open={offboardTarget !== null} onOpenChange={() => setOffboardTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('person.offboardTitle', { name: offboardTarget?.full_name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('person.offboardWarning')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = offboardTarget;
                setOffboardTarget(null);
                if (target) runAction(() => PersonService.offboard(target.id));
              }}
            >
              {t('person.offboard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editPerson ? t('person.editSheet') : t('person.newSheet')}</SheetTitle>
          </SheetHeader>
          {editPerson
            ? <EditPerson id={editPerson.id} initialData={editPerson} onCancel={() => setFormOpen(false)} onSuccess={() => { setFormOpen(false); refresh(); }} />
            : <NewPerson
                onCancel={() => setFormOpen(false)}
                onSuccess={(invite, name, id) => {
                  setFormOpen(false);
                  refresh();
                  setEnroll({ invite, name, id });
                }}
              />}
        </SheetContent>
      </Sheet>

      <EnrollmentDialog
        open={enroll !== null}
        personId={enroll?.id ?? null}
        personName={enroll?.name}
        invite={enroll?.invite ?? null}
        onOpenChange={(o) => { if (!o) { setEnroll(null); refresh(); } }}
        onReissued={(invite) => setEnroll((cur) => (cur ? { ...cur, invite } : cur))}
      />
    </>
  );
}
