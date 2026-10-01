'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Input } from '@/design-system/components';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>('/auth/password/forgot', { method: 'POST', body: { email } });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao enviar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ds-auth">
      <div className="ds-auth-card ds-stack ds-fade-in" style={{ gap: 'var(--space-5)' }}>
        <h1 className="ds-page-title">Recuperar acesso</h1>
        <form className="ds-card" onSubmit={onSubmit} noValidate>
          {message && <Alert tone="ok">{message}</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Input label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy}>
            Enviar link
          </Button>
          <Link href="/login" style={{ fontSize: 14 }}>
            Voltar ao login
          </Link>
        </form>
      </div>
    </main>
  );
}
