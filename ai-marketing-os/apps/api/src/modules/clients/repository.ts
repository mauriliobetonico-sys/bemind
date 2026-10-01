import type { CreateClientInput, UpdateClientInput } from '@aimos/shared';
import type { Tx } from '../../db/pool';

export interface ClientRow {
  id: string;
  tenant_id: string;
  legal_name: string;
  trade_name: string;
  cnpj: string | null;
  responsible_name: string;
  phone: string | null;
  email: string;
  address: Record<string, string>;
  segment: string | null;
  niche: string | null;
  plan: string;
  status: string;
  monthly_fee_cents: string;
  currency: string;
  start_date: string | null;
  due_day: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  tenant_status?: string;
}

export function toClientDto(r: ClientRow) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    legalName: r.legal_name,
    tradeName: r.trade_name,
    cnpj: r.cnpj,
    responsibleName: r.responsible_name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    segment: r.segment,
    niche: r.niche,
    plan: r.plan,
    status: r.status,
    monthlyFeeCents: Number(r.monthly_fee_cents),
    currency: r.currency,
    startDate: r.start_date,
    dueDay: r.due_day,
    notes: r.notes,
    tenantStatus: r.tenant_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export type ClientDto = ReturnType<typeof toClientDto>;

/** Mapeamento campo da API → coluna. Lista fechada: nada fora dela vira SQL. */
const COLUMNS: Record<keyof UpdateClientInput, string> = {
  legalName: 'legal_name',
  tradeName: 'trade_name',
  cnpj: 'cnpj',
  responsibleName: 'responsible_name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  segment: 'segment',
  niche: 'niche',
  plan: 'plan',
  status: 'status',
  monthlyFeeCents: 'monthly_fee_cents',
  startDate: 'start_date',
  dueDay: 'due_day',
  notes: 'notes',
};

const SELECT = `SELECT c.*, to_char(c.start_date, 'YYYY-MM-DD') AS start_date, t.status AS tenant_status
                  FROM clients c JOIN tenants t ON t.id = c.tenant_id`;

export async function listClients(tx: Tx, f: { q?: string; status?: string; limit: number; offset: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(c.trade_name ILIKE $${params.length} OR c.legal_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.cnpj ILIKE $${params.length})`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`c.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number((await tx.query<{ n: string }>(`SELECT count(*) AS n FROM clients c ${whereSql}`, params)).rows[0]!.n);
  params.push(f.limit, f.offset);
  const rows = (
    await tx.query<ClientRow>(
      `${SELECT} ${whereSql} ORDER BY c.trade_name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
  ).rows;
  return { total, items: rows.map(toClientDto) };
}

export async function findClient(tx: Tx, id: string, forUpdate = false): Promise<ClientRow | undefined> {
  return (await tx.query<ClientRow>(`${SELECT} WHERE c.id = $1 ${forUpdate ? 'FOR UPDATE OF c' : ''}`, [id])).rows[0];
}

export async function insertClient(tx: Tx, tenantId: string, input: CreateClientInput, createdBy: string): Promise<ClientRow> {
  const row = (
    await tx.query<{ id: string }>(
      `INSERT INTO clients (tenant_id, legal_name, trade_name, cnpj, responsible_name, phone, email, address,
                            segment, niche, plan, status, monthly_fee_cents, start_date, due_day, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        tenantId,
        input.legalName,
        input.tradeName,
        input.cnpj ?? null,
        input.responsibleName,
        input.phone ?? null,
        input.email,
        JSON.stringify(input.address ?? {}),
        input.segment ?? null,
        input.niche ?? null,
        input.plan,
        input.status,
        input.monthlyFeeCents,
        input.startDate ?? null,
        input.dueDay ?? null,
        input.notes ?? null,
        createdBy,
      ],
    )
  ).rows[0]!;
  return (await findClient(tx, row.id))!;
}

export async function updateClient(tx: Tx, id: string, input: UpdateClientInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, value] of Object.entries(input) as [keyof UpdateClientInput, unknown][]) {
    const column = COLUMNS[key];
    if (!column) continue;
    params.push(key === 'address' ? JSON.stringify(value ?? {}) : (value ?? null));
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return;
  await tx.query(`UPDATE clients SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function insertClientEvent(
  tx: Tx,
  e: { tenantId: string; clientId: string; actorUserId: string | null; type: string; data?: Record<string, unknown> },
): Promise<void> {
  await tx.query(
    `INSERT INTO client_events (tenant_id, client_id, actor_user_id, type, data) VALUES ($1, $2, $3, $4, $5)`,
    [e.tenantId, e.clientId, e.actorUserId, e.type, JSON.stringify(e.data ?? {})],
  );
}

/** Eventos de bastidor (QA interno, agentes de IA): só a equipe vê. */
export const INTERNAL_EVENT_TYPES = ['deliverable.qa_rejected', 'deliverable.submitted_for_qa', 'deliverable.created'];

export async function listClientEvents(tx: Tx, clientId: string, limit = 100, opts: { includeInternal: boolean } = { includeInternal: false }) {
  return (
    await tx.query<{ id: string; type: string; data: Record<string, unknown>; created_at: Date; actor_name: string | null }>(
      `SELECT e.id, e.type, e.data, e.created_at, u.name AS actor_name
         FROM client_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.client_id = $1
          AND ($3 OR (e.type <> ALL($4) AND e.type NOT LIKE 'ai.%'))
        ORDER BY e.created_at DESC
        LIMIT $2`,
      [clientId, limit, opts.includeInternal, INTERNAL_EVENT_TYPES],
    )
  ).rows.map((r) => ({ id: r.id, type: r.type, data: r.data, createdAt: r.created_at, actorName: r.actor_name }));
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length >= 2 ? base : `cliente-${base}`;
}
