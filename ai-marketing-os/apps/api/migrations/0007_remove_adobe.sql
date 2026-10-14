-- A integração Adobe Firefly foi substituída pelo gerador de imagens (OpenAI).
-- Pedidos ainda não executados são cancelados e as conexões (credenciais
-- cifradas) são apagadas; o histórico de chamadas concluídas é mantido.
-- Contexto de sistema para as políticas RLS (o dono do banco já as ignora como superusuário).
SELECT set_config('app.scope', 'system', true);

UPDATE mcp_tool_calls
   SET status = 'cancelled', error = 'Integração Adobe removida', finished_at = COALESCE(finished_at, now())
 WHERE connector = 'adobe' AND status IN ('pending_approval', 'queued');

UPDATE mcp_tool_calls SET connection_id = NULL WHERE connector = 'adobe' AND connection_id IS NOT NULL;
DELETE FROM mcp_connections WHERE connector = 'adobe';
DELETE FROM mcp_tool_policies WHERE tool LIKE 'adobe.%';
