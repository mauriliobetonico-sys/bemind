import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { withContext } from '../../db/pool';
import { notFound } from '../../lib/errors';
import { requestedTenant, requireAccess } from '../../security/plugin';
import { listClientEvents, toClientDto, type ClientRow } from '../clients/repository';

/**
 * Indicadores que dependem de módulos ainda não construídos. A API declara
 * explicitamente a fase em vez de devolver números simulados.
 */
const PENDING_MODULES = [
  { key: 'contracts', label: 'Contratos e propostas', phase: 3 },
  { key: 'payments', label: 'Pagamentos e inadimplência', phase: 3 },
  { key: 'agents', label: 'Agentes ativos e com erro', phase: 4 },
  { key: 'ai_costs', label: 'Custos de IA', phase: 4 },
];

export async function dashboardRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/dashboard/admin', { config: { permission: 'dashboard:admin' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('dashboard:admin', requestedTenant(req)), async (tx) => {
      const totals = (
        await tx.query<{
          total: number;
          active: number;
          onboarding: number;
          prospect: number;
          paused: number;
          churned: number;
          new_this_month: number;
          mrr_cents: string;
        }>(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE status = 'active')::int AS active,
                  count(*) FILTER (WHERE status = 'onboarding')::int AS onboarding,
                  count(*) FILTER (WHERE status = 'prospect')::int AS prospect,
                  count(*) FILTER (WHERE status = 'paused')::int AS paused,
                  count(*) FILTER (WHERE status = 'churned')::int AS churned,
                  count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month,
                  coalesce(sum(monthly_fee_cents) FILTER (WHERE status = 'active'), 0) AS mrr_cents
             FROM clients`,
        )
      ).rows[0]!;

      const byPlan = (
        await tx.query<{ plan: string; count: number; mrr_cents: string }>(
          `SELECT plan, count(*)::int AS count,
                  coalesce(sum(monthly_fee_cents) FILTER (WHERE status = 'active'), 0) AS mrr_cents
             FROM clients GROUP BY plan ORDER BY plan`,
        )
      ).rows.map((r) => ({ plan: r.plan, count: r.count, mrrCents: Number(r.mrr_cents) }));

      const attention = (
        await tx.query<{ id: string; trade_name: string; status: string; created_at: Date; pending_invite: boolean }>(
          `SELECT c.id, c.trade_name, c.status, c.created_at,
                  EXISTS (SELECT 1 FROM tenant_users tu JOIN users u ON u.id = tu.user_id
                           WHERE tu.tenant_id = c.tenant_id AND tu.role_key = 'CLIENTE' AND u.status = 'invited') AS pending_invite
             FROM clients c
            WHERE c.status IN ('onboarding', 'paused')
            ORDER BY c.created_at
            LIMIT 10`,
        )
      ).rows.map((r) => ({
        clientId: r.id,
        tradeName: r.trade_name,
        status: r.status,
        since: r.created_at,
        reason: r.status === 'paused' ? 'Cliente pausado' : r.pending_invite ? 'Onboarding — convite ainda não aceito' : 'Onboarding em andamento',
      }));

      const ops = (
        await tx.query<{
          open_demands: number;
          new_demands: number;
          in_production: number;
          overdue_demands: number;
          approvals_pending: number;
          approvals_stale: number;
          open_tasks: number;
          overdue_tasks: number;
          tasks_due_today: number;
        }>(
          `SELECT
             (SELECT count(*)::int FROM demands WHERE status NOT IN ('delivered','cancelled')) AS open_demands,
             (SELECT count(*)::int FROM demands WHERE status = 'submitted') AS new_demands,
             (SELECT count(*)::int FROM demands WHERE status IN ('in_production','in_review','changes_requested')) AS in_production,
             (SELECT count(*)::int FROM demands WHERE due_date < current_date AND status NOT IN ('approved','delivered','cancelled')) AS overdue_demands,
             (SELECT count(*)::int FROM approvals WHERE status = 'pending') AS approvals_pending,
             (SELECT count(*)::int FROM approvals WHERE status = 'pending' AND created_at < now() - interval '3 days') AS approvals_stale,
             (SELECT count(*)::int FROM tasks WHERE status <> 'done') AS open_tasks,
             (SELECT count(*)::int FROM tasks WHERE status <> 'done' AND due_date < current_date) AS overdue_tasks,
             (SELECT count(*)::int FROM tasks WHERE status <> 'done' AND due_date = current_date) AS tasks_due_today`,
        )
      ).rows[0]!;

      const workAttention = (
        await tx.query<{ kind: string; id: string; title: string; client_name: string; client_id: string; detail: string }>(
          `SELECT * FROM (
             SELECT 'demand_new' AS kind, d.id, d.title, t.name AS client_name, c.id AS client_id, 'Nova demanda aguardando triagem' AS detail, d.created_at AS at
               FROM demands d JOIN tenants t ON t.id = d.tenant_id JOIN clients c ON c.tenant_id = d.tenant_id
              WHERE d.status = 'submitted'
             UNION ALL
             SELECT 'demand_overdue', d.id, d.title, t.name, c.id, 'Demanda atrasada (prazo ' || to_char(d.due_date, 'DD/MM') || ')', d.due_date::timestamptz
               FROM demands d JOIN tenants t ON t.id = d.tenant_id JOIN clients c ON c.tenant_id = d.tenant_id
              WHERE d.due_date < current_date AND d.status NOT IN ('approved','delivered','cancelled')
             UNION ALL
             SELECT 'changes_requested', d.id, d.title, t.name, c.id, 'Cliente pediu alteração', d.updated_at
               FROM demands d JOIN tenants t ON t.id = d.tenant_id JOIN clients c ON c.tenant_id = d.tenant_id
              WHERE d.status = 'changes_requested'
             UNION ALL
             SELECT 'approval_stale', v.demand_id, v.title, t.name, c.id, 'Aprovação parada há mais de 3 dias', a.created_at
               FROM approvals a JOIN deliverables v ON v.tenant_id = a.tenant_id AND v.id = a.deliverable_id
               JOIN tenants t ON t.id = a.tenant_id JOIN clients c ON c.tenant_id = a.tenant_id
              WHERE a.status = 'pending' AND a.created_at < now() - interval '3 days'
           ) x ORDER BY at LIMIT 15`,
        )
      ).rows.map((r) => ({ kind: r.kind, demandId: r.id, title: r.title, clientName: r.client_name, clientId: r.client_id, detail: r.detail }));

      const timeline = (
        await tx.query<{ id: string; type: string; created_at: Date; trade_name: string; client_id: string; actor_name: string | null; data: Record<string, unknown> }>(
          `SELECT e.id, e.type, e.created_at, c.trade_name, c.id AS client_id, u.name AS actor_name, e.data
             FROM client_events e
             JOIN clients c ON c.tenant_id = e.tenant_id AND c.id = e.client_id
             LEFT JOIN users u ON u.id = e.actor_user_id
            ORDER BY e.created_at DESC
            LIMIT 20`,
        )
      ).rows.map((r) => ({
        id: r.id,
        type: r.type,
        at: r.created_at,
        clientId: r.client_id,
        clientName: r.trade_name,
        actorName: r.actor_name,
        data: r.data,
      }));

      const mrrCents = Number(totals.mrr_cents);
      return {
        clients: {
          total: totals.total,
          active: totals.active,
          onboarding: totals.onboarding,
          prospect: totals.prospect,
          paused: totals.paused,
          churned: totals.churned,
          newThisMonth: totals.new_this_month,
        },
        revenue: {
          mrrCents,
          averageTicketCents: totals.active > 0 ? Math.round(mrrCents / totals.active) : 0,
          basis: 'Mensalidade cadastrada dos clientes ativos (contratos e pagamentos entram na fase 3)',
        },
        byPlan,
        attention,
        operations: {
          openDemands: ops.open_demands,
          newDemands: ops.new_demands,
          inProduction: ops.in_production,
          overdueDemands: ops.overdue_demands,
          approvalsPending: ops.approvals_pending,
          approvalsStale: ops.approvals_stale,
          openTasks: ops.open_tasks,
          overdueTasks: ops.overdue_tasks,
          tasksDueToday: ops.tasks_due_today,
        },
        workAttention,
        timeline,
        pendingModules: PENDING_MODULES,
      };
    });
  });

  /** Portal do cliente: somente os tenants do próprio usuário. */
  app.get('/portal/overview', { config: { permission: 'dashboard:client' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('dashboard:client', requestedTenant(req)), async (tx) => {
      const rows = (
        await tx.query<ClientRow>(
          `SELECT c.*, to_char(c.start_date, 'YYYY-MM-DD') AS start_date, t.status AS tenant_status
             FROM clients c JOIN tenants t ON t.id = c.tenant_id ORDER BY c.trade_name`,
        )
      ).rows;
      const first = rows[0];
      if (!first) throw notFound();
      return {
        companies: rows.map((r) => ({ tenantId: r.tenant_id, tradeName: r.trade_name })),
        client: toClientDto(first),
        history: await listClientEvents(tx, first.id, 20),
        work: (
          await tx.query(
            `SELECT
               (SELECT count(*)::int FROM approvals WHERE status = 'pending' AND tenant_id = $1) AS "approvalsPending",
               (SELECT count(*)::int FROM demands WHERE status NOT IN ('delivered','cancelled') AND tenant_id = $1) AS "openDemands",
               (SELECT count(*)::int FROM demands WHERE status IN ('planning','in_production','in_review','changes_requested') AND tenant_id = $1) AS "inProduction",
               (SELECT count(*)::int FROM demands WHERE status IN ('approved','delivered') AND tenant_id = $1) AS "completed"`,
            [first.tenant_id],
          )
        ).rows[0],
        pendingModules: [
          { key: 'contract', label: 'Contrato e financeiro', phase: 3 },
          { key: 'agents', label: 'Sua equipe de agentes', phase: 4 },
          { key: 'reports', label: 'Relatório diário', phase: 6 },
        ],
      };
    });
  });
}
