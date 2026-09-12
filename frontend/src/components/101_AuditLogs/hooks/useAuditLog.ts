import { useCallback, useEffect, useRef, useState } from 'react';
import { AuditLogService, type AuditLog } from '../services/auditLog.service';

const LIMIT = 20;

export function useAuditLog() {
  const [data, setData]         = useState<AuditLog[]>([]);
  const [total, setTotal]       = useState<number | undefined>(undefined);
  const [hasMore, setHasMore]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearchRaw]  = useState('');
  const [filters, setFiltersRaw] = useState<Record<string, string>>({});
  const [sortField, setSortFieldRaw] = useState('');
  const [sortDir, setSortDirRaw] = useState<'asc' | 'desc'>('asc');
  const [pageIndex, setPageIndex] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const cursors = useRef<(string | null)[]>([null]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const cursor = cursors.current[pageIndex] ?? null;
    const withCount = pageIndex === 0;
    setLoading(true);
    setError(null);
    setHasMore(false);
    AuditLogService.getAll(search, cursor, LIMIT, withCount, filters, sortField, sortDir, pageIndex + 1)
      .then((res) => {
        setData(res.data);
        setHasMore(res.hasMore);
        if (res.total !== undefined) setTotal(res.total);
        if (res.nextCursor) cursors.current[pageIndex + 1] = res.nextCursor;
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [search, filters, sortField, sortDir, pageIndex, refreshToken]);

  const setSearch = (q: string) => {
    cursors.current = [null];
    setTotal(undefined);
    setPageIndex(0);
    setSearchRaw(q);
  };

  const setSort = (field: string, dir: 'asc' | 'desc') => {
    cursors.current = [null];
    setTotal(undefined);
    setPageIndex(0);
    setSortFieldRaw(field);
    setSortDirRaw(dir);
  };

  const setFilter = (key: string, value: string) => {
    cursors.current = [null];
    setTotal(undefined);
    setPageIndex(0);
    setFiltersRaw((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);
  const clearFilters = useCallback(() => {
    cursors.current = [null];
    setTotal(undefined);
    setPageIndex(0);
    setFiltersRaw({});
  }, []);

  const nextPage = () => { if (hasMore) setPageIndex((i) => i + 1); };
  const prevPage = () => { if (pageIndex > 0) setPageIndex((i) => i - 1); };


  return { data, loading, error, refresh, search, setSearch, filters, setFilter, clearFilters, sortField, sortDir, setSort, page: pageIndex + 1, nextPage, prevPage, hasMore, total };
}
