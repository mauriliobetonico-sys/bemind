'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Input } from '@/design-system/components';

export default function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      await refresh();
      const next = new URLSearchParams(window.location.search).get('next');
      // Só redireciona para caminhos internos (evita open redirect).
      window.location.assign(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
      setBusy(false);
    }
  }

  return (
    <main className="ds-auth">
      <div className="ds-auth-card ds-stack ds-fade-in" style={{ gap: 'var(--space-5)' }}>
        <div className="ds-brand" style={{ padding: 0 }}>
          <span className="ds-brand-mark" />
          <span>Marketing OS</span>
        </div>
        <div className="ds-stack" style={{ gap: 6 }}>
          <h1 className="ds-page-title">Entrar</h1>
          <p className="ds-text-2">Sua equipe de marketing está trabalhando.</p>
        </div>
        <form className="ds-card" onSubmit={onSubmit} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Input label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
          <Link href="/forgot-password" style={{ fontSize: 14 }}>
            Esqueci minha senha
          </Link>
        </form>
      </div>
    </main>
  );
}
