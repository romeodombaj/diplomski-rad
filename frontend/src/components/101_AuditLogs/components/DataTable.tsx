import { useState } from "react";
import {
  flexRender,
  coreRowModelsFeature,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/UI/button";
import { Skeleton } from "@/UI/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/UI/table";

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCreate?: () => void;
  hasActiveFilters?: boolean;
  onEdit?: (row: TData) => void;
  onDelete?: (row: TData) => void;
  page?: number;
  hasMore?: boolean;
  total?: number;
  onNext?: () => void;
  onPrev?: () => void;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (field: string, dir: 'asc' | 'desc') => void;
}

export function DataTable<TData>({
  columns,
  data,
  loading,
  error,
  onRetry,
  onCreate,
  hasActiveFilters,
  onEdit,
  onDelete,
  page,
  hasMore,
  total,
  onNext,
  onPrev,
  sortField,
  sortDir,
  onSort,
}: DataTableProps<TData>) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const actionColumn: ColumnDef<TData> = {
    id: "_actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-2">
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={() => onEdit(row.original)}>
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon" onClick={() => onDelete(row.original)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    ),
  };

  const table = useTable({
    data,
    columns: [...columns, actionColumn],
    coreFeatures: [coreRowModelsFeature],
  });

  const colCount = columns.length + 1;

  function renderBody() {
    if (loading && !data.length) {
      return Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: colCount }).map((_, j) => (
            <TableCell key={j} className="py-2">
              <Skeleton className="h-6 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ));
    }
    if (error) {
      return (
        <TableRow>
          <TableCell colSpan={colCount} className="h-32 text-center">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-destructive">{error}</p>
              {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>{t('table.retry')}</Button>}
            </div>
          </TableCell>
        </TableRow>
      );
    }
    if (!table.getRowModel().rows.length) {
      return (
        <TableRow>
          <TableCell colSpan={colCount} className="h-32 text-center">
            {onCreate && !hasActiveFilters ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-muted-foreground">{t('table.noItems')}</p>
                <Button size="sm" onClick={onCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('table.createFirstOne')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('table.noResults')}</p>
            )}
          </TableCell>
        </TableRow>
      );
    }
    return table.getRowModel().rows.map((row) => (
      <TableRow
        key={row.id}
        onClick={() => setSelectedId(row.id)}
        className={selectedId === row.id ? "bg-muted" : ""}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id} className="py-0">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    ));
  }

  return (
    <div>
      <div className="rounded-md">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : (
                      <div
                        className={
                          header.column.getCanSort()
                            ? "flex items-center gap-1 cursor-pointer select-none"
                            : ""
                        }
                        onClick={() => {
                          if (!header.column.getCanSort() || !onSort) return;
                          const newDir = sortField === header.column.id && sortDir === 'asc' ? 'desc' : 'asc';
                          onSort(header.column.id, newDir);
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          sortField === header.column.id
                            ? (sortDir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />)
                            : <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </div>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {renderBody()}
          </TableBody>
        </Table>
      </div>
      {((onNext || onPrev) || (loading && !!data.length)) && (
        <div className="flex items-center justify-between sticky bottom-0 bg-background pb-2 pt-3 border-t">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {total !== undefined ? t('table.results', { count: total }) : ''}
            </span>
            {loading && !!data.length && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {(onNext || onPrev) && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">{t('table.page', { page })}</span>
              <Button variant="outline" size="sm" onClick={onPrev} disabled={(page ?? 1) <= 1}>
                <ChevronLeft className="h-4 w-4" />
                {t('table.prev')}
              </Button>
              <Button variant="outline" size="sm" onClick={onNext} disabled={!hasMore}>
                {t('table.next')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
