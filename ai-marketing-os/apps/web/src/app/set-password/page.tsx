'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Input } from '@/design-system/components';

export default function SetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t);
    // Remove o token da barra de endereço e do histórico.
    if (t) window.history.replaceState(null, '', '/set-password');
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('As senhas não conferem.');
    if (password.length < 12) return setError('Use pelo menos 12 caracteres.');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/set', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível definir a senha.');
    } finally {
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
        <h1 className="ds-page-title">Crie sua senha</h1>
        {done ? (
          <div className="ds-card">
            <Alert tone="ok">Senha definida. Agora é só entrar com seu e-mail.</Alert>
            <Link className="ds-btn ds-btn-primary" href="/login">
              Ir para o login
            </Link>
          </div>
        ) : token === null ? (
          <Alert tone="warn">Link incompleto. Abra o link recebido por e-mail novamente.</Alert>
        ) : (
          <form className="ds-card" onSubmit={onSubmit} noValidate>
            {error && <Alert tone="danger">{error}</Alert>}
            <Input label="Nova senha" type="password" autoComplete="new-password" hint="Mínimo de 12 caracteres." value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input label="Confirme a senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Salvando…' : 'Definir senha'}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
