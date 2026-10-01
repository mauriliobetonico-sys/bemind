/**
 * Cliente HTTP do frontend. Fala apenas com /api na mesma origem, envia o
 * token CSRF em toda requisição que altera estado e nunca guarda tokens de
 * sessão (o cookie de sessão é httpOnly).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.split('; ').find((c) => c.startsWith('__Host-aimos_csrf=') || c.startsWith('aimos_csrf='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
}

/** Páginas acessíveis sem sessão: um 401 nelas não redireciona. */
const PUBLIC_PATHS = ['/login', '/set-password', '/forgot-password'];

let tenantHeader: string | null = null;
/** Seleciona um tenant específico (apenas estreita o escopo; o servidor valida). */
export function setActiveTenant(tenantId: string | null) {
  tenantHeader = tenantId;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; tenant?: boolean; tenantId?: string | null; form?: FormData } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
  }
  const tenant = init.tenantId ?? (init.tenant !== false ? tenantHeader : null);
  if (tenant) headers['x-tenant-id'] = tenant;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });

  if (res.status === 204 || (res.status === 202 && !res.headers.get('content-type')?.includes('json'))) {
    return (res.headers.get('content-type')?.includes('json') ? await res.json() : undefined) as T;
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p))) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Erro inesperado', data?.details);
  }
  return data as T;
}

export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.map((d) => [d.path, d.message]));
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('pt-BR') : '—';
export const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
