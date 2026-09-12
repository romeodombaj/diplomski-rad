import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/UI/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/UI/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/UI/table';
import { PolicyService, type DoorAccessRow } from '@/components/107_access/services/policy.service';
import { SyncBadge } from '@/components/107_access/components/SyncBadge';

interface Props {
  doorId: number | null;
  doorName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DoorAccessDialog({ doorId, doorName, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DoorAccessRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!doorId) return;
    setLoading(true);
    try {
      setRows(await PolicyService.whoHasAccess(doorId));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [doorId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('doors.access.title', { name: doorName ?? '' })}</SheetTitle>
          <SheetDescription>{t('doors.access.hint')}</SheetDescription>
        </SheetHeader>

        {error && <p className="text-destructive text-sm mt-2">{error}</p>}

        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('doors.access.person')}</TableHead>
                <TableHead>{t('doors.access.via')}</TableHead>
                <TableHead>{t('doors.access.hours')}</TableHead>
                <TableHead>{t('doors.access.chain')}</TableHead>
                <TableHead>{t('doors.access.openNow')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={5}>{t('doors.access.loading')}</TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {t('doors.access.nobody')}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.full_name ?? (
                      <span className="font-mono text-xs">{r.did.slice(0, 22)}…</span>
                    )}
                    {r.person_status !== 'active' && (
                      <Badge variant="secondary" className="ml-2">{r.person_status}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.source === 'group' ? 'secondary' : 'outline'}>
                      {r.source_name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.schedule}</TableCell>
                  <TableCell><SyncBadge status={r.sync_status} /></TableCell>
                  <TableCell>
                    {
}
                    {r.open_now
                      ? <Badge variant="default">{t('doors.access.yes')}</Badge>
                      : <Badge variant="outline">{t('doors.access.no')}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  );
}
