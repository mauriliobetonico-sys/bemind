'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { RISK_LABELS } from '@aimos/shared';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { ClientPicker } from '@/components/client-picker';
import { usePolling } from '@/components/ai-panel';
import { CallRow, type ToolCall } from '@/components/tool-call-row';
import { Alert, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, Textarea } from '@/design-system/components';

const SIZES = [
  { value: 'square', label: 'Quadrado 1:1 (2048×2048)' },
  { value: 'portrait', label: 'Retrato 3:4 (1792×2304)' },
  { value: 'landscape', label: 'Paisagem 4:3 (2304×1792)' },
  { value: 'widescreen', label: 'Widescreen 16:9 (2688×1536)' },
];
const VARIATIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: `${v} ${v === '1' ? 'imagem' : 'imagens'}` }));

interface Connection {
  tenantId: string;
  connector: string;
  status: 'active' | 'disabled' | 'error';
}
interface FileItem {
  id: string;
  name: string;
  mime: string;
  scanStatus: string;
}
interface Demand {
  id: string;
  title: string;
}

type Msg = { tone: 'ok' | 'danger' | 'warn'; text: string } | null;

function useRequest(tenantId: string, setMsg: (m: Msg) => void, onQueued: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const request = async (tool: string, params: Record<string, unknown>, reason: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ status: string; risk: 'LOW' | 'MEDIUM' | 'HIGH' }>('/mcp/tool-calls', { method: 'POST', body: { tool, params, reason }, tenantId });
      setMsg(
        r.status === 'pending_approval'
          ? { tone: 'warn', text: `Risco ${RISK_LABELS[r.risk].toLowerCase()}: aguardando aprovação em "Ações das ferramentas".` }
          : { tone: 'ok', text: 'Na fila da Adobe: as imagens aparecem abaixo em instantes.' },
      );
      await onQueued();
      return true;
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, request };
}

function GenerateCard({ tenantId, demands, setMsg, onQueued }: { tenantId: string; demands: Demand[]; setMsg: (m: Msg) => void; onQueued: () => Promise<void> }) {
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [size, setSize] = useState('square');
  const [n, setN] = useState('1');
  const [contentClass, setContentClass] = useState('');
  const [demandId, setDemandId] = useState('');
  const { busy, request } = useRequest(tenantId, setMsg, onQueued);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const params = {
      prompt,
      size,
      numVariations: Number(n),
      ...(negative.trim() ? { negativePrompt: negative.trim() } : {}),
      ...(contentClass ? { contentClass } : {}),
      ...(demandId ? { demandId } : {}),
    };
    if (await request('adobe.generate_image', params, 'Geração de imagem no Estúdio criativo')) setPrompt('');
  };

  return (
    <Card title="Gerar imagem">
      <form className="ds-stack" onSubmit={(e) => void submit(e)}>
        <Textarea label="Descreva a imagem" required minLength={3} maxLength={1024} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: xícara de café fumegante sobre mesa de madeira, luz suave da manhã, fotografia de produto" />
        <Input label="Evitar (opcional)" maxLength={1024} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="Ex.: texto, marcas d'água, pessoas" />
        <div className="ds-grid ds-grid-2">
          <Select label="Formato" value={size} onChange={(e) => setSize(e.target.value)} options={SIZES} />
          <Select label="Quantidade" value={n} onChange={(e) => setN(e.target.value)} options={VARIATIONS} />
          <Select label="Estilo" value={contentClass} onChange={(e) => setContentClass(e.target.value)} options={[{ value: '', label: 'Automático' }, { value: 'photo', label: 'Fotográfico' }, { value: 'art', label: 'Artístico' }]} />
          <Select label="Vincular à demanda (opcional)" value={demandId} onChange={(e) => setDemandId(e.target.value)} options={[{ value: '', label: 'Nenhuma' }, ...demands.map((d) => ({ value: d.id, label: d.title }))]} />
        </div>
        <span className="ds-stat-hint">Cada imagem consome créditos generativos do contrato Adobe da agência. O resultado fica nos arquivos internos do cliente (ele só vê depois de enviado para aprovação).</span>
        <div>
          <Button type="submit" variant="primary" disabled={busy || prompt.trim().length < 3}>
            {busy ? 'Enviando…' : 'Gerar com Adobe Firefly'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ExpandCard({ tenantId, version, setMsg, onQueued }: { tenantId: string; version: number; setMsg: (m: Msg) => void; onQueued: () => Promise<void> }) {
  const files = useApi<{ items: FileItem[] }>('/files?category=image', { tenantId });
  const reloadFiles = files.reload;
  // Imagens recém-geradas passam a valer como origem.
  useEffect(() => {
    if (version > 0) void reloadFiles();
  }, [version, reloadFiles]);
  const usable = (files.data?.items ?? []).filter((f) => ['image/png', 'image/jpeg', 'image/webp'].includes(f.mime) && (f.scanStatus === 'clean' || f.scanStatus === 'skipped'));
  const [fileId, setFileId] = useState('');
  const [size, setSize] = useState('widescreen');
  const [prompt, setPrompt] = useState('');
  const { busy, request } = useRequest(tenantId, setMsg, onQueued);
  const chosen = fileId || usable[0]?.id || '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await request('adobe.expand_image', { fileId: chosen, size, ...(prompt.trim().length >= 3 ? { prompt: prompt.trim() } : {}) }, 'Expansão de imagem no Estúdio criativo');
  };

  return (
    <Card title="Expandir imagem (mudar formato)">
      {!files.data ? (
        <Skeleton height={160} />
      ) : usable.length === 0 ? (
        <EmptyState>
          Nenhuma imagem JPEG, PNG ou WEBP deste cliente. Envie em <Link href="/files">Arquivos e marca</Link>.
        </EmptyState>
      ) : (
        <form className="ds-stack" onSubmit={(e) => void submit(e)}>
          <Select label="Imagem de origem" value={chosen} onChange={(e) => setFileId(e.target.value)} options={usable.map((f) => ({ value: f.id, label: f.name }))} />
          {chosen && <img className="ds-preview" style={{ maxHeight: 200 }} src={`/api/files/${chosen}/download?inline=1`} alt="Prévia da imagem de origem" />}
          <Select label="Novo formato" value={size} onChange={(e) => setSize(e.target.value)} options={SIZES} />
          <Input label="O que preencher nas bordas (opcional)" maxLength={1024} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: continuação da mesa de madeira" />
          <span className="ds-stat-hint">O original não é alterado; a versão expandida entra como novo arquivo interno.</span>
          <div>
            <Button type="submit" disabled={busy || !chosen}>
              {busy ? 'Enviando…' : 'Expandir com Adobe Firefly'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export default function CreativeStudioPage() {
  const { can } = useAuth();
  const [tenantId, setTenantId] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const conns = useApi<{ items: Connection[] }>('/mcp/connections');
  const demands = useApi<{ items: Demand[] }>(tenantId ? '/demands?open=true&limit=100' : null, { tenantId });
  const calls = useApi<{ items: ToolCall[] }>(tenantId ? '/mcp/tool-calls?connector=adobe&limit=20' : null, { tenantId });
  const items = calls.data?.items ?? [];
  usePolling(items.some((c) => c.status === 'queued' || c.status === 'running'), calls.reload);
  const conn = conns.data?.items.find((c) => c.tenantId === tenantId && c.connector === 'adobe');
  const ready = conn?.status === 'active' || conn?.status === 'error';

  return (
    <>
      <PageHeader eyebrow="Adobe Firefly Services" title="Estúdio criativo" actions={<Link href="/integrations">Integrações</Link>} />
      <p className="ds-text-2">Gere e adapte imagens com a API oficial do Adobe Firefly. Toda chamada passa pelo MCP Hub: fica registrada, respeita os limites e, quando um agente pede, espera aprovação humana.</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ClientPicker value={tenantId} onChange={(v) => { setTenantId(v); setMsg(null); }} />
      </Card>
      {!tenantId ? (
        <EmptyState>Escolha um cliente para começar.</EmptyState>
      ) : !conns.data ? (
        <Skeleton height={200} />
      ) : !ready ? (
        <Alert tone="warn">
          A Adobe ainda não está conectada para este cliente{conn?.status === 'disabled' ? ' (conexão desativada)' : ''}.{' '}
          {can('mcp:manage') ? <Link href="/integrations">Conectar em Integrações</Link> : 'Peça a um administrador para conectar em Integrações.'}
        </Alert>
      ) : can('mcp:use') ? (
        <div className="ds-grid ds-grid-2">
          <GenerateCard key={`g-${tenantId}`} tenantId={tenantId} demands={demands.data?.items ?? []} setMsg={setMsg} onQueued={calls.reload} />
          <ExpandCard key={`e-${tenantId}`} tenantId={tenantId} version={items.filter((c) => c.status === 'succeeded').length} setMsg={setMsg} onQueued={calls.reload} />
        </div>
      ) : null}
      {tenantId && (
        <Card title="Resultados recentes" action={<Button size="sm" variant="ghost" onClick={() => void calls.reload()}>Atualizar</Button>}>
          {calls.error && <Alert tone="danger">{calls.error.message}</Alert>}
          {!calls.data ? (
            <Skeleton height={120} />
          ) : items.length === 0 ? (
            <EmptyState>Nenhuma geração ainda para este cliente.</EmptyState>
          ) : (
            <ul className="ds-list">
              {items.map((c) => (
                <CallRow key={`${c.id}-${c.status}`} c={c} onDone={(t, tone) => { setMsg({ tone: tone ?? 'ok', text: t }); void calls.reload(); }} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
