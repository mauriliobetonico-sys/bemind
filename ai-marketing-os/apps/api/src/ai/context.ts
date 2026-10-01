import type { MemoryKind } from '@aimos/shared';
import { MEMORY_KIND_LABELS } from '@aimos/shared';
import type { Tx } from '../db/pool';
import { fence } from './agents';
import { toVectorLiteral, type Embedder } from './embeddings';

/**
 * Monta o contexto de UM cliente para o prompt. Roda sempre numa transação
 * com RLS restrito ao tenant do job — mesmo um bug aqui não alcança outro
 * cliente. Todo conteúdo sai delimitado como dado (fence).
 */
export async function clientContext(tx: Tx, tenantId: string): Promise<string> {
  const c = (
    await tx.query<{ trade_name: string; segment: string | null; niche: string | null; plan: string; status: string; notes: string | null }>(
      `SELECT trade_name, segment, niche, plan, status, notes FROM clients WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows[0];
  const assets = (
    await tx.query<{ kind: string; title: string; value: string | null; notes: string | null }>(
      `SELECT kind, title, value, notes FROM brand_assets WHERE tenant_id = $1 AND kind <> 'logo' ORDER BY kind, created_at LIMIT 60`,
      [tenantId],
    )
  ).rows;
  const lines = [
    c ? `Cliente: ${c.trade_name}` : 'Cliente: (sem cadastro)',
    c?.segment ? `Segmento: ${c.segment}` : null,
    c?.niche ? `Nicho: ${c.niche}` : null,
    c ? `Plano: ${c.plan} · status ${c.status}` : null,
    c?.notes ? `Observações: ${c.notes.slice(0, 2000)}` : null,
    assets.length ? 'Brand Vault:' : 'Brand Vault: vazio (sem cores, fontes ou manual cadastrados).',
    ...assets.map((a) => `- [${a.kind}] ${a.title}${a.value ? `: ${a.value.slice(0, 500)}` : ''}${a.notes ? ` (${a.notes.slice(0, 300)})` : ''}`),
  ].filter(Boolean);
  return fence('dados_do_cliente', lines.join('\n'));
}

/**
 * Memória APROVADA do cliente, filtrada pelos escopos do agente. Com
 * embeddings configurados, ordena por similaridade com a tarefa; senão,
 * regras de marca primeiro e depois as mais recentes.
 */
export async function memoryContext(
  tx: Tx,
  tenantId: string,
  scopes: MemoryKind[],
  query: string,
  embedder: Embedder,
  limit = 25,
): Promise<string> {
  let rows: { kind: MemoryKind; content: string }[] | null = null;
  if (embedder.configured && query.trim()) {
    try {
      const [vec] = await embedder.embed([query]);
      if (vec) {
        rows = (
          await tx.query(
            `SELECT kind, content FROM agent_memories
              WHERE tenant_id = $1 AND status = 'approved' AND kind = ANY($2)
              ORDER BY (kind = 'brand_rules') DESC, embedding <=> $3::vector NULLS LAST, updated_at DESC
              LIMIT $4`,
            [tenantId, scopes, toVectorLiteral(vec), limit],
          )
        ).rows;
      }
    } catch {
      rows = null; // embeddings indisponíveis: cai na ordenação simples
    }
  }
  rows ??= (
    await tx.query(
      `SELECT kind, content FROM agent_memories
        WHERE tenant_id = $1 AND status = 'approved' AND kind = ANY($2)
        ORDER BY (kind = 'brand_rules') DESC, updated_at DESC LIMIT $3`,
      [tenantId, scopes, limit],
    )
  ).rows;
  if (!rows.length) return fence('memoria', 'Nenhuma memória aprovada ainda para este cliente.');
  return fence('memoria', rows.map((r) => `- (${MEMORY_KIND_LABELS[r.kind]}) ${r.content}`).join('\n'));
}

export async function demandContext(tx: Tx, demandId: string): Promise<{ text: string; title: string; projectId: string | null }> {
  const d = (
    await tx.query<{ title: string; type: string; description: string; priority: string; due: string | null; refs: string | null; notes: string | null; project_id: string | null }>(
      `SELECT title, type, description, priority, to_char(due_date, 'DD/MM/YYYY') AS due, refs, notes, project_id
         FROM demands WHERE id = $1`,
      [demandId],
    )
  ).rows[0];
  if (!d) throw new Error('demanda não encontrada no tenant do job');
  const b = (
    await tx.query<{ objective: string; audience: string | null; key_messages: string | null; deliverables: string | null; tone: string | null; constraints: string | null }>(
      `SELECT objective, audience, key_messages, deliverables, tone, constraints FROM briefings WHERE demand_id = $1 ORDER BY version DESC LIMIT 1`,
      [demandId],
    )
  ).rows[0];
  const lines = [
    `Título: ${d.title}`,
    `Tipo: ${d.type} · prioridade ${d.priority}${d.due ? ` · prazo ${d.due}` : ''}`,
    `Descrição: ${d.description}`,
    d.refs ? `Referências: ${d.refs}` : null,
    d.notes ? `Observações: ${d.notes}` : null,
    b ? 'Briefing:' : 'Briefing: ainda não preenchido.',
    b ? `- Objetivo: ${b.objective}` : null,
    b?.audience ? `- Público: ${b.audience}` : null,
    b?.key_messages ? `- Mensagens-chave: ${b.key_messages}` : null,
    b?.deliverables ? `- Entregáveis: ${b.deliverables}` : null,
    b?.tone ? `- Tom: ${b.tone}` : null,
    b?.constraints ? `- Restrições: ${b.constraints}` : null,
  ].filter(Boolean);
  return { text: fence('demanda', lines.join('\n')), title: d.title, projectId: d.project_id };
}
