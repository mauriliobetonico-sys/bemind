import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

/**
 * Cliente HTTP das integrações, com proteção contra SSRF:
 *  - só http(s); HTTPS obrigatório para hosts públicos;
 *  - o IP é validado NO MOMENTO DA CONEXÃO (lookup próprio), então um DNS
 *    que muda entre a checagem e a conexão (rebinding) não passa;
 *  - redes privadas, loopback, link-local (inclui 169.254.169.254, metadados
 *    de nuvem) e afins são recusadas, salvo MCP_ALLOW_PRIVATE_HOSTS=true;
 *  - redirecionamentos não são seguidos; resposta limitada em tamanho e tempo.
 */
export class IntegrationHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Falha transitória (rede, 5xx, 429): vale tentar de novo. */
    readonly retryable = false,
  ) {
    super(message);
  }
}

function ipv4ToInt(ip: string) {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

export interface HttpOptions {
  allowPrivate: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface HttpResult {
  status: number;
  body: string;
  json<T = unknown>(): T;
}

export function assertSafeUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new IntegrationHttpError('URL inválida');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new IntegrationHttpError('Somente http/https');
  if (url.username || url.password) throw new IntegrationHttpError('Credenciais na URL não são permitidas');
  if (!allowPrivate && url.protocol !== 'https:') throw new IntegrationHttpError('Use HTTPS');
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new IntegrationHttpError('Endereço privado não permitido');
  }
  return url;
}

export function safeRequest(
  method: 'GET' | 'POST' | 'PUT',
  rawUrl: string,
  opts: HttpOptions & { headers?: Record<string, string>; body?: string },
): Promise<HttpResult> {
  const url = assertSafeUrl(rawUrl, opts.allowPrivate);
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const lookup: LookupFunction = (hostname, options, cb) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, '', 4);
      const list = addresses as unknown as LookupAddress[];
      const bad = list.find((a) => !opts.allowPrivate && isPrivateAddress(a.address));
      if (bad) return cb(new IntegrationHttpError('Endereço privado não permitido'), '', 4);
      if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      const first = list[0];
      if (!first) return cb(new Error('host sem endereço'), '', 4);
      cb(null, first.address, first.family);
    });
  };
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      { method, headers: { 'user-agent': 'AI-Marketing-OS/1.0', ...opts.headers }, lookup, timeout: opts.timeoutMs ?? 20_000 },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new IntegrationHttpError(`Redirecionamento não permitido (HTTP ${status})`, status));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new IntegrationHttpError('Resposta grande demais'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status,
            body,
            json: <T>() => {
              try {
                return JSON.parse(body) as T;
              } catch {
                throw new IntegrationHttpError(`Resposta não é JSON (HTTP ${status})`, status);
              }
            },
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new IntegrationHttpError('Tempo esgotado', undefined, true)));
    req.on('error', (err) =>
      reject(err instanceof IntegrationHttpError ? err : new IntegrationHttpError(`Falha de conexão: ${(err as Error).message}`, undefined, true)),
    );
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Erro HTTP do serviço externo → mensagem curta, sem ecoar o corpo inteiro. */
export function httpFailure(service: string, r: HttpResult): IntegrationHttpError {
  let detail = '';
  try {
    const j = r.json<{ message?: string; code?: string }>();
    detail = j.message ? `: ${String(j.message).slice(0, 200)}` : '';
  } catch {
    /* corpo não-JSON */
  }
  return new IntegrationHttpError(`${service} respondeu HTTP ${r.status}${detail}`, r.status, r.status >= 500 || r.status === 429);
}
