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

export async function api<T>(path: string, init: { method?: string; body?: unknown; tenant?: boolean } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
  }
  if (init.tenant !== false && tenantHeader) headers['x-tenant-id'] = tenantHeader;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 204 || res.status === 202) {
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
