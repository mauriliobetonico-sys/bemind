'use client';

import { useRef, useState, type DragEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, Button } from '@/design-system/components';

export interface UploadResult {
  files: { id: string; name: string; category: string }[];
  rejected: { name: string; reason: string }[];
  summary: string;
}

/** Upload por arrastar-e-soltar ou seleção, com resumo da classificação. */
export function FileDrop({
  tenantId,
  query = '',
  onUploaded,
  compact,
}: {
  tenantId?: string | null;
  query?: string;
  onUploaded?: (r: UploadResult) => void;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(list: FileList | null) {
    if (!list || list.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(list)) form.append('files', f, f.name);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<UploadResult>(`/files${query}`, { method: 'POST', form, tenantId });
      setResult(r);
      onUploaded?.(r);
    } catch (err) {
      const e = err as ApiError & { details?: unknown };
      setError(e instanceof ApiError ? e.message : 'Falha no envio');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void send(e.dataTransfer.files);
  };

  return (
    <div className="ds-stack">
      <div
        className="ds-dropzone"
        data-over={over}
        data-compact={compact}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p style={{ fontWeight: 500 }}>{busy ? 'Enviando e classificando…' : 'Arraste arquivos para cá'}</p>
        {!compact && <p className="ds-stat-hint">PDF, DOCX, XLSX, PPTX, imagens, vídeos, ZIP, PSD, AI, fontes · até 20 por vez</p>}
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
          Escolher arquivos
        </Button>
        <input ref={input} type="file" multiple hidden onChange={(e) => void send(e.target.files)} aria-label="Escolher arquivos para enviar" />
      </div>
      {result && (
        <Alert tone={result.rejected.length ? 'warn' : 'ok'}>
          {result.summary}
          {result.rejected.length > 0 && <> Recusados: {result.rejected.map((r) => `${r.name} (${r.reason})`).join(', ')}.</>}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
