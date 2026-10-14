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
  { value: 'square', label: 'Quadrado 1:1 (feed)' },
  { value: 'portrait', label: 'Retrato 2:3 (stories, pin)' },
  { value: 'landscape', label: 'Paisagem 3:2 (banner, blog)' },
];
const QUALITIES = [
  { value: '', label: 'Padrão do servidor' },
  { value: 'low', label: 'Rascunho (mais barato)' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta (mais cara)' },
];
const COUNTS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: `${v} ${v === '1' ? 'imagem' : 'imagens'}` }));
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

interface Catalog {
  connectors: { key: string; availability: string; requirements: string | null }[];
}
interface FileItem {
  id: string;
  name: string;
  mime: string;
  scanStatus: string;
  category: string;
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
          : { tone: 'ok', text: 'Gerando: as imagens aparecem abaixo em até 1–2 minutos.' },
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

function useClientImages(tenantId: string, version: number) {
  const files = useApi<{ items: FileItem[] }>('/files', { tenantId });
  const reload = files.reload;
  useEffect(() => {
    if (version > 0) void reload();
  }, [version, reload]);
  const usable = (files.data?.items ?? []).filter((f) => IMAGE_MIMES.includes(f.mime) && (f.scanStatus === 'clean' || f.scanStatus === 'skipped'));
  return { loaded: !!files.data, usable };
}

function GenerateCard({ tenantId, demands, images, setMsg, onQueued }: { tenantId: string; demands: Demand[]; images: FileItem[]; setMsg: (m: Msg) => void; onQueued: () => Promise<void> }) {
  const [prompt, setPrompt] = useState('');
  const [avoid, setAvoid] = useState('');
  const [size, setSize] = useState('square');
  const [n, setN] = useState('1');
  const [quality, setQuality] = useState('');
  const [useBrand, setUseBrand] = useState(true);
  const [refs, setRefs] = useState<string[]>([]);
  const [demandId, setDemandId] = useState('');
  const { busy, request } = useRequest(tenantId, setMsg, onQueued);
  const toggleRef = (id: string) => setRefs((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length >= 4 ? r : [...r, id]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const params = {
      prompt,
      size,
      n: Number(n),
      useBrand,
      ...(avoid.trim() ? { avoid: avoid.trim() } : {}),
      ...(quality ? { quality } : {}),
      ...(refs.length ? { referenceFileIds: refs } : {}),
      ...(demandId ? { demandId } : {}),
    };
    if (await request('images.generate', params, 'Geração de imagem no Estúdio criativo')) setPrompt('');
  };

  return (
    <Card title="Gerar imagem">
      <form className="ds-stack" onSubmit={(e) => void submit(e)}>
        <Textarea
          label="Descreva a imagem"
          required
          minLength={3}
          maxLength={4000}
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={'Ex.: post para Instagram anunciando o café gelado de verão. Copo com gelo sobre balcão de madeira, luz natural, clima alegre. Texto na imagem: "Verão gelado — 20% off"'}
        />
        <span className="ds-stat-hint">Dica: diga o objetivo (post, banner, anúncio), o cenário, o clima e, se quiser texto na arte, escreva entre aspas exatamente o que deve aparecer.</span>
        <Input label="Evitar (opcional)" maxLength={500} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="Ex.: pessoas, fundo escuro, marcas concorrentes" />
        <div className="ds-grid ds-grid-2">
          <Select label="Formato" value={size} onChange={(e) => setSize(e.target.value)} options={SIZES} />
          <Select label="Quantidade" value={n} onChange={(e) => setN(e.target.value)} options={COUNTS} />
          <Select label="Qualidade" value={quality} onChange={(e) => setQuality(e.target.value)} options={QUALITIES} />
          <Select label="Vincular à demanda (opcional)" value={demandId} onChange={(e) => setDemandId(e.target.value)} options={[{ value: '', label: 'Nenhuma' }, ...demands.map((d) => ({ value: d.id, label: d.title }))]} />
        </div>
        <label className="ds-check">
          <input type="checkbox" checked={useBrand} onChange={(e) => setUseBrand(e.target.checked)} /> Usar a identidade do cliente (segmento, cores e fontes do Brand Vault)
        </label>
        {images.length > 0 && (
          <fieldset className="ds-stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
            <legend className="ds-label">Imagens de referência (opcional, até 4) — logo, produto, foto</legend>
            <div className="ds-thumbs" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
              {images.slice(0, 24).map((f) => {
                const on = refs.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleRef(f.id)}
                    aria-pressed={on}
                    title={f.name}
                    style={{ padding: 0, border: on ? '3px solid var(--accent)' : '3px solid transparent', borderRadius: 'var(--radius)', background: 'none', cursor: 'pointer' }}
                  >
                    <img src={`/api/files/${f.id}/download?inline=1`} alt={f.name} loading="lazy" />
                  </button>
                );
              })}
            </div>
            {refs.length > 0 && <span className="ds-stat-hint">{refs.length} selecionada(s): o gerador preserva formas e cores delas.</span>}
          </fieldset>
        )}
        <span className="ds-stat-hint">Cada imagem é cobrada pela OpenAI na conta da agência. O resultado fica nos arquivos internos do cliente — ele só vê depois de enviado para aprovação.</span>
        <div>
          <Button type="submit" variant="primary" disabled={busy || prompt.trim().length < 3}>
            {busy ? 'Enviando…' : 'Gerar imagem'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EditCard({ tenantId, images, loaded, setMsg, onQueued }: { tenantId: string; images: FileItem[]; loaded: boolean; setMsg: (m: Msg) => void; onQueued: () => Promise<void> }) {
  const [fileId, setFileId] = useState('');
  const [instruction, setInstruction] = useState('');
  const [size, setSize] = useState('');
  const { busy, request } = useRequest(tenantId, setMsg, onQueued);
  const chosen = fileId || images[0]?.id || '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await request('images.edit', { fileId: chosen, instruction, ...(size ? { size } : {}) }, 'Ajuste de imagem no Estúdio criativo')) setInstruction('');
  };

  return (
    <Card title="Ajustar uma imagem">
      {!loaded ? (
        <Skeleton height={160} />
      ) : images.length === 0 ? (
        <EmptyState>
          Nenhuma imagem JPEG, PNG ou WEBP deste cliente. Envie em <Link href="/files">Arquivos e marca</Link> ou gere uma ao lado.
        </EmptyState>
      ) : (
        <form className="ds-stack" onSubmit={(e) => void submit(e)}>
          <Select label="Imagem" value={chosen} onChange={(e) => setFileId(e.target.value)} options={images.map((f) => ({ value: f.id, label: f.name }))} />
          {chosen && <img className="ds-preview" style={{ maxHeight: 200 }} src={`/api/files/${chosen}/download?inline=1`} alt="Prévia da imagem escolhida" />}
          <Textarea label="O que mudar" required minLength={3} maxLength={4000} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ex.: troque o fundo por uma praia ao pôr do sol; deixe no formato de stories" />
          <Select label="Formato" value={size} onChange={(e) => setSize(e.target.value)} options={[{ value: '', label: 'Manter automático' }, ...SIZES]} />
          <span className="ds-stat-hint">O original não é alterado; a nova versão entra como arquivo interno.</span>
          <div>
            <Button type="submit" disabled={busy || !chosen || instruction.trim().length < 3}>
              {busy ? 'Enviando…' : 'Criar nova versão'}
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
  const catalog = useApi<Catalog>('/mcp/catalog');
  const demands = useApi<{ items: Demand[] }>(tenantId ? '/demands?open=true&limit=100' : null, { tenantId });
  const calls = useApi<{ items: ToolCall[] }>(tenantId ? '/mcp/tool-calls?connector=images&limit=20' : null, { tenantId });
  const items = calls.data?.items ?? [];
  usePolling(items.some((c) => c.status === 'queued' || c.status === 'running'), calls.reload);
  const images = useClientImages(tenantId, items.filter((c) => c.status === 'succeeded').length);
  const gen = catalog.data?.connectors.find((c) => c.key === 'images');

  return (
    <>
      <PageHeader eyebrow="Imagens com IA" title="Estúdio criativo" actions={<Link href="/tool-calls">Ações das ferramentas</Link>} />
      <p className="ds-text-2">Crie artes a partir de uma descrição, na identidade visual do cliente e usando as imagens dele como referência. Toda geração fica registrada e, quando um agente pede, espera aprovação humana.</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ClientPicker value={tenantId} onChange={(v) => { setTenantId(v); setMsg(null); }} />
      </Card>
      {!catalog.data ? (
        <Skeleton height={120} />
      ) : gen?.availability !== 'available' ? (
        <Alert tone="warn">O gerador de imagens ainda não está ativo: {gen?.requirements ?? 'configure OPENAI_API_KEY no .env do servidor.'}</Alert>
      ) : !tenantId ? (
        <EmptyState>Escolha um cliente para começar.</EmptyState>
      ) : can('mcp:use') ? (
        <div className="ds-grid ds-grid-2">
          <GenerateCard key={`g-${tenantId}`} tenantId={tenantId} demands={demands.data?.items ?? []} images={images.usable} setMsg={setMsg} onQueued={calls.reload} />
          <EditCard key={`e-${tenantId}`} tenantId={tenantId} images={images.usable} loaded={images.loaded} setMsg={setMsg} onQueued={calls.reload} />
        </div>
      ) : null}
      {tenantId && (
        <Card title="Resultados recentes" action={<Button size="sm" variant="ghost" onClick={() => void calls.reload()}>Atualizar</Button>}>
          {calls.error && <Alert tone="danger">{calls.error.message}</Alert>}
          {!calls.data ? (
            <Skeleton height={120} />
          ) : items.length === 0 ? (
            <EmptyState>Nenhuma imagem gerada ainda para este cliente.</EmptyState>
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
