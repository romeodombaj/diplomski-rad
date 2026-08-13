import { useCallback, useEffect, useState } from 'react';
import { UsersService, type AppUser } from '../services/users.service';

export function useUsers() {
  const [data, setData] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    UsersService.getAll()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);
  const remove = (id: string) => UsersService.remove(id).then(refresh);

  return { data, loading, error, refresh, remove };
}
