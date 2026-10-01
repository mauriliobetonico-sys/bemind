'use client';

import { useState, type FormEvent } from 'react';
import { BRAND_KIND_LABELS, BRAND_KINDS, FILE_CATEGORIES, FILE_CATEGORY_LABELS, type FileCategory } from '@aimos/shared';
import { api, ApiError, fmtBytes, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { ClientPicker, useClientOptions } from '@/components/client-picker';
import { FileDrop } from '@/components/file-drop';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, Textarea } from '@/design-system/components';

interface FileItem {
  id: string;
  tenantId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  category: FileCategory;
  scanStatus: string;
  visibility: string;
  createdAt: string;
  uploadedByName: string | null;
}
interface BrandAsset {
  id: string;
  tenantId: string;
  kind: (typeof BRAND_KINDS)[number];
  title: string;
  value: string | null;
  notes: string | null;
  fileId: string | null;
  fileName: string | null;
  fileMime: string | null;
}

const SCAN = { pending: ['em verificação', 'warn'], infected: ['bloqueado', 'danger'], error: ['falha na verificação', 'danger'] } as const;

export default function FilesPage() {
  const { can } = useAuth();
  const { staff, options } = useClientOptions();
  const [tab, setTab] = useState<'files' | 'brand'>('files');
  const [tenantId, setTenantId] = useState('');
  const [category, setCategory] = useState('');
  const files = useApi<{ items: FileItem[] }>(`/files${category ? `?category=${category}` : ''}`);
  const brand = useApi<{ items: BrandAsset[] }>('/brand-assets');
  const [msg, setMsg] = useState<string | null>(null);
  const nameOf = (t: string) => options.find((o) => o.tenantId === t)?.tradeName ?? '';
  const visibleFiles = (files.data?.items ?? []).filter((f) => !staff || !tenantId || f.tenantId === tenantId);
  const visibleBrand = (brand.data?.items ?? []).filter((b) => !staff || !tenantId || b.tenantId === tenantId);
  const canUpload = !staff || !!tenantId;

  const remove = async (f: FileItem) => {
    if (!window.confirm(`Excluir "${f.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/files/${f.id}`, { method: 'DELETE' });
      await Promise.all([files.reload(), brand.reload()]);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao excluir');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Biblioteca" title="Arquivos e marca" />
      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <ClientPicker value={tenantId} onChange={setTenantId} allowAll />
      </div>
      <div className="ds-tabs" role="tablist">
        <button className="ds-tab" role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
          Arquivos
        </button>
        <button className="ds-tab" role="tab" aria-selected={tab === 'brand'} onClick={() => setTab('brand')}>
          Brand Vault
        </button>
      </div>
      {msg && <Alert tone="danger">{msg}</Alert>}

      {tab === 'files' ? (
        <>
          {can('files:write') &&
            (canUpload ? (
              <FileDrop tenantId={staff ? tenantId : null} onUploaded={() => void files.reload()} />
            ) : (
              <Alert>Selecione um cliente para enviar arquivos.</Alert>
            ))}
          <div className="ds-row" style={{ alignItems: 'flex-end' }}>
            <Select
              label="Categoria"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[{ value: '', label: 'Todas' }, ...FILE_CATEGORIES.map((c) => ({ value: c, label: FILE_CATEGORY_LABELS[c][1] }))]}
              style={{ minWidth: 200 }}
            />
          </div>
          {!files.data ? (
            <Skeleton height={240} />
          ) : visibleFiles.length === 0 ? (
            <div className="ds-card">
              <EmptyState>Nenhum arquivo.</EmptyState>
            </div>
          ) : (
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th scope="col">Arquivo</th>
                    {staff && <th scope="col">Cliente</th>}
                    <th scope="col">Categoria</th>
                    <th scope="col" className="ds-num">
                      Tamanho
                    </th>
                    <th scope="col">Enviado</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((f) => {
                    const scan = SCAN[f.scanStatus as keyof typeof SCAN];
                    return (
                      <tr key={f.id}>
                        <td>
                          <span style={{ fontWeight: 500 }}>{f.name}</span>
                          <div className="ds-row" style={{ gap: 6, marginTop: 4 }}>
                            {f.visibility === 'internal' && <Badge>interno</Badge>}
                            {scan && <Badge tone={scan[1]}>{scan[0]}</Badge>}
                          </div>
                        </td>
                        {staff && <td>{nameOf(f.tenantId)}</td>}
                        <td>{FILE_CATEGORY_LABELS[f.category][0]}</td>
                        <td className="ds-num">{fmtBytes(f.sizeBytes)}</td>
                        <td className="ds-stat-hint">
                          {fmtDate(f.createdAt)}
                          {f.uploadedByName && ` · ${f.uploadedByName}`}
                        </td>
                        <td>
                          <div className="ds-row" style={{ gap: 6 }}>
                            <a className="ds-btn ds-btn-sm" href={`/api/files/${f.id}/download`}>
                              Baixar
                            </a>
                            {can('files:delete') && (
                              <Button size="sm" variant="ghost" onClick={() => void remove(f)} aria-label={`Excluir ${f.name}`}>
                                Excluir
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <BrandVault
          assets={visibleBrand}
          files={visibleFiles.filter((f) => f.visibility === 'client')}
          tenantId={staff ? tenantId : null}
          canWrite={can('files:write') && canUpload}
          onChange={() => void brand.reload()}
          loading={!brand.data}
        />
      )}
    </>
  );
}

function BrandVault({
  assets,
  files,
  tenantId,
  canWrite,
  onChange,
  loading,
}: {
  assets: BrandAsset[];
  files: FileItem[];
  tenantId: string | null;
  canWrite: boolean;
  onChange: () => void;
  loading: boolean;
}) {
  const [v, setV] = useState({ kind: 'color', title: '', value: '', fileId: '', notes: '' });
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/brand-assets', { method: 'POST', tenantId, body: { kind: v.kind, title: v.title, value: v.value || null, fileId: v.fileId || null, notes: v.notes || null } });
      setV({ kind: v.kind, title: '', value: '', fileId: '', notes: '' });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    }
  }
  const remove = async (id: string) => {
    await api(`/brand-assets/${id}`, { method: 'DELETE' }).catch(() => undefined);
    onChange();
  };

  const colors = assets.filter((a) => a.kind === 'color');
  const others = assets.filter((a) => a.kind !== 'color');

  return (
    <div className="ds-grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
      <div className="ds-stack" style={{ gap: 'var(--space-4)' }}>
        <Card title="Paleta">
          {colors.length === 0 ? (
            <EmptyState>Nenhuma cor cadastrada.</EmptyState>
          ) : (
            <div className="ds-grid ds-grid-2">
              {colors.map((c) => (
                <div key={c.id} className="ds-row" style={{ flexWrap: 'nowrap' }}>
                  <span className="ds-swatch" style={{ background: c.value ?? undefined }} aria-hidden="true" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{c.title}</div>
                    <div className="ds-mono ds-stat-hint">{c.value}</div>
                  </div>
                  {canWrite && (
                    <Button size="sm" variant="ghost" onClick={() => void remove(c.id)} aria-label={`Remover ${c.title}`}>
                      Remover
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Logos, fontes, manuais e referências">
          {loading ? (
            <Skeleton height={120} />
          ) : others.length === 0 ? (
            <EmptyState>Nada cadastrado ainda. Os agentes de IA (fase 4) vão consultar o que estiver aqui.</EmptyState>
          ) : (
            <ul className="ds-list">
              {others.map((a) => (
                <li key={a.id}>
                  <span>
                    <Badge>{BRAND_KIND_LABELS[a.kind]}</Badge> <strong style={{ fontWeight: 500 }}>{a.title}</strong>
                    {a.value && <span className="ds-text-2"> — {a.value}</span>}
                    {a.notes && <div className="ds-stat-hint">{a.notes}</div>}
                  </span>
                  <span className="ds-row" style={{ gap: 6 }}>
                    {a.fileId && (
                      <a className="ds-btn ds-btn-sm" href={`/api/files/${a.fileId}/download`}>
                        Baixar
                      </a>
                    )}
                    {canWrite && (
                      <Button size="sm" variant="ghost" onClick={() => void remove(a.id)} aria-label={`Remover ${a.title}`}>
                        Remover
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {canWrite && (
        <Card title="Adicionar ao Brand Vault">
          <form className="ds-stack" onSubmit={add}>
            {error && <Alert tone="danger">{error}</Alert>}
            <Select label="Tipo" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={BRAND_KINDS.map((k) => ({ value: k, label: BRAND_KIND_LABELS[k] }))} />
            <Input label="Nome" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
            {v.kind === 'color' ? (
              <Input label="Cor (#RRGGBB)" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} placeholder="#0F766E" />
            ) : (
              <>
                <Select label="Arquivo" value={v.fileId} onChange={(e) => setV({ ...v, fileId: e.target.value })} options={[{ value: '', label: 'Sem arquivo' }, ...files.map((f) => ({ value: f.id, label: f.name }))]} />
                <Input label="Valor ou descrição" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} placeholder="Ex.: Montserrat · R$ 49,90 · link" />
              </>
            )}
            <Textarea label="Observações" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
            <Button type="submit" variant="primary">
              Adicionar
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
