import type pg from 'pg';
import { withContext, SYSTEM, type Tx } from '../db/pool';

export interface OutboxEvent {
  id: string;
  tenant_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

/**
 * Registra um evento de domínio na MESMA transação do dado que o originou
 * (padrão outbox): se a transação falhar, o evento não existe.
 */
export async function enqueue(
  tx: Tx,
  event: { type: string; tenantId?: string | null; payload: Record<string, unknown> },
): Promise<void> {
  await tx.query('INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, $2, $3)', [
    event.tenantId ?? null,
    event.type,
    JSON.stringify(event.payload),
  ]);
}

const LEASE_MS = 5 * 60_000;

export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

export interface ProcessResult {
  processed: number;
  failed: number;
  dead: number;
}

/**
 * Reivindica eventos pendentes (lease com SKIP LOCKED, seguro com vários
 * workers), executa o handler e marca como concluído, reagenda com backoff
 * exponencial ou move para 'dead' após o limite de tentativas.
 * Um evento só é marcado como concluído se o handler terminar sem erro.
 */
export async function processOutbox(
  pool: pg.Pool,
  handlers: Record<string, OutboxHandler>,
  opts: { batchSize?: number; maxAttempts: number },
): Promise<ProcessResult> {
  const claimed = await withContext(pool, SYSTEM, async (tx) =>
    (
      await tx.query<OutboxEvent>(
        `UPDATE outbox_events SET attempts = attempts + 1, available_at = now() + ($2 || ' milliseconds')::interval
          WHERE id IN (
            SELECT id FROM outbox_events
             WHERE status = 'pending' AND available_at <= now()
             ORDER BY available_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED)
          RETURNING id, tenant_id, type, payload, attempts`,
        [opts.batchSize ?? 10, String(LEASE_MS)],
      )
    ).rows,
  );

  const result: ProcessResult = { processed: 0, failed: 0, dead: 0 };
  for (const event of claimed) {
    const handler = handlers[event.type];
    try {
      if (!handler) throw new Error(`sem handler para ${event.type}`);
      await handler(event);
      await withContext(pool, SYSTEM, (tx) =>
        tx.query(`UPDATE outbox_events SET status = 'done', processed_at = now(), last_error = NULL WHERE id = $1`, [
          event.id,
        ]),
      );
      result.processed++;
    } catch (err) {
      const message = (err as Error).message?.slice(0, 1000) ?? 'erro desconhecido';
      const isDead = event.attempts >= opts.maxAttempts;
      await withContext(pool, SYSTEM, (tx) =>
        tx.query(
          `UPDATE outbox_events
              SET status = $2, last_error = $3,
                  available_at = now() + ($4 || ' milliseconds')::interval
            WHERE id = $1`,
          [event.id, isDead ? 'dead' : 'pending', message, String(backoffMs(event.attempts))],
        ),
      );
      if (isDead) result.dead++;
      else result.failed++;
    }
  }
  return result;
}
