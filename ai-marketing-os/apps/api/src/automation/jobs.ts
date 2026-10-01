import type { AppContext } from '../context';
import { SYSTEM, withContext, type Tx } from '../db/pool';
import { enqueue } from '../outbox/outbox';
import { notificationEmail } from '../mail/templates';
import { clientUsers, deliver, teamFor, userById } from '../notifications/notify';
import { localNow } from './daily-report';

const LOCK_KEY = 424243;

/** Marca a rotina como executada para a chave (data). Só um worker vence a corrida. */
async function claimJob(tx: Tx, job: string, runKey: string, detail?: Record<string, unknown>): Promise<boolean> {
  return !!(await tx.query(`INSERT INTO job_runs (job, run_key, detail) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`, [job, runKey, JSON.stringify(detail ?? {})])).rowCount;
}

/**
 * Rotinas diárias, chamadas pelo worker a cada poucos minutos. Cada uma roda
 * uma vez por dia (data local da agência), depois da hora configurada:
 *  - relatório diário: enfileira um 'report.generate' por cliente elegível;
 *  - lembretes: enfileira 'reminders.run'.
 * O trabalho pesado vai para a fila (retry/backoff), não fica no loop.
 */
export async function automationTick(ctx: AppContext, now = new Date()): Promise<{ reports: number; reminders: boolean }> {
  const { date, hour, weekend } = localNow(ctx.env.APP_TIMEZONE, now);
  return withContext(ctx.pool, SYSTEM, async (tx) => {
    const locked = (await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_KEY])).rows[0]!.ok;
    if (!locked) return { reports: 0, reminders: false };
    let reports = 0;
    if (hour >= ctx.env.DAILY_REPORT_HOUR && (await claimJob(tx, 'daily_reports', date))) {
      const tenants = (
        await tx.query<{ tenant_id: string }>(
          `SELECT c.tenant_id FROM clients c JOIN tenants t ON t.id = c.tenant_id
            WHERE t.status = 'active' AND c.status IN ('active', 'onboarding') AND c.daily_report_enabled
              AND (NOT c.daily_report_weekdays_only OR NOT $1)`,
          [weekend],
        )
      ).rows;
      for (const t of tenants) await enqueue(tx, { type: 'report.generate', tenantId: t.tenant_id, payload: { date } });
      reports = tenants.length;
    }
    let reminders = false;
    if (hour >= ctx.env.REMINDERS_HOUR && (await claimJob(tx, 'reminders', date))) {
      await enqueue(tx, { type: 'reminders.run', payload: { date } });
      reminders = true;
    }
    return { reports, reminders };
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Lembretes do dia: tarefas atrasadas (responsável, ou gestores se não houver),
 * prazos de hoje/amanhã (equipe do cliente) e aprovações paradas há 2+ dias
 * (usuários do próprio cliente). Uma notificação agregada por pessoa e cliente.
 */
export async function runReminders(ctx: AppContext, date: string): Promise<number> {
  const base = ctx.env.APP_URL.replace(/\/$/, '');
  const mails = await withContext(ctx.pool, SYSTEM, async (tx) => {
    let queued = 0;
    const overdue = (
      await tx.query<{ tenant_id: string; client: string; assignee_id: string | null; n: number; titles: string[] }>(
        `SELECT t.tenant_id, te.name AS client, t.assignee_id, count(*)::int AS n, (array_agg(t.title ORDER BY t.due_date))[1:5] AS titles
           FROM tasks t JOIN tenants te ON te.id = t.tenant_id
          WHERE t.status <> 'done' AND t.due_date < $1::date AND te.status = 'active'
          GROUP BY t.tenant_id, te.name, t.assignee_id`,
        [date],
      )
    ).rows;
    for (const o of overdue) {
      const recipients = o.assignee_id ? await userById(tx, o.assignee_id) : (await teamFor(tx, o.tenant_id)).filter(Boolean);
      queued += await deliver(tx, {
          tenantId: o.tenant_id,
          recipients,
          category: 'deadline',
          title: `${plural(o.n, 'tarefa atrasada', 'tarefas atrasadas')} — ${o.client}`,
          body: o.titles.join(' · '),
          link: '/tasks',
          email: (r) => notificationEmail({ to: r.email, title: `Tarefas atrasadas — ${o.client}`, intro: `Olá, ${r.name}! Há ${plural(o.n, 'tarefa atrasada', 'tarefas atrasadas')}.`, details: o.titles.map((t, i) => [`${i + 1}.`, t] as [string, string]), cta: { url: `${base}/tasks`, label: 'Ver tarefas' } }),
        });
    }
    const due = (
      await tx.query<{ tenant_id: string; client: string; n: number; titles: string[] }>(
        `SELECT d.tenant_id, te.name AS client, count(*)::int AS n, (array_agg(d.title || ' (' || to_char(d.due_date, 'DD/MM') || ')' ORDER BY d.due_date))[1:5] AS titles
           FROM demands d JOIN tenants te ON te.id = d.tenant_id
          WHERE d.due_date BETWEEN $1::date AND $1::date + 1 AND d.status NOT IN ('approved', 'delivered', 'cancelled') AND te.status = 'active'
          GROUP BY d.tenant_id, te.name`,
        [date],
      )
    ).rows;
    for (const d of due) {
      queued += await deliver(tx, {
          tenantId: d.tenant_id,
          recipients: await teamFor(tx, d.tenant_id),
          category: 'deadline',
          title: `Prazo próximo: ${plural(d.n, 'demanda', 'demandas')} — ${d.client}`,
          body: d.titles.join(' · '),
          link: '/demands',
          email: (r) => notificationEmail({ to: r.email, title: `Prazos de hoje e amanhã — ${d.client}`, intro: `Olá, ${r.name}! Estas demandas vencem hoje ou amanhã.`, details: d.titles.map((t, i) => [`${i + 1}.`, t] as [string, string]), cta: { url: `${base}/demands`, label: 'Ver demandas' } }),
        });
    }
    const stale = (
      await tx.query<{ tenant_id: string; n: number; titles: string[] }>(
        `SELECT a.tenant_id, count(*)::int AS n, (array_agg(v.title ORDER BY a.created_at))[1:5] AS titles
           FROM approvals a JOIN deliverables v ON v.tenant_id = a.tenant_id AND v.id = a.deliverable_id JOIN tenants te ON te.id = a.tenant_id
          WHERE a.status = 'pending' AND a.created_at < now() - interval '2 days' AND te.status = 'active'
          GROUP BY a.tenant_id`,
      )
    ).rows;
    for (const s of stale) {
      queued += await deliver(tx, {
          tenantId: s.tenant_id,
          recipients: await clientUsers(tx, s.tenant_id),
          category: 'approval',
          title: `${plural(s.n, 'item aguarda', 'itens aguardam')} a sua aprovação`,
          body: s.titles.join(' · '),
          link: '/approvals',
          email: (r) => notificationEmail({ to: r.email, title: 'Aprovação pendente', intro: `Olá, ${r.name}! ${plural(s.n, 'entregável aguarda', 'entregáveis aguardam')} a sua aprovação há mais de 2 dias.`, details: s.titles.map((t, i) => [`${i + 1}.`, t] as [string, string]), cta: { url: `${base}/approvals`, label: 'Revisar agora' } }),
        });
    }
    return queued;
  });
  return mails;
}
