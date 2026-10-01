'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Busca simples com estados de carregamento e erro. `tenantId` estreita o escopo (header X-Tenant-Id). */
export function useApi<T>(path: string | null, opts: { tenantId?: string | null } = {}) {
  const tenantId = opts.tenantId || null;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path, tenantId ? { tenantId } : {}));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'network', 'Falha de conexão'));
    } finally {
      setLoading(false);
    }
  }, [path, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}
