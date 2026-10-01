'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Permission } from '@aimos/shared';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Avatar, Button, Skeleton } from '@/design-system/components';

interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
  phase?: number;
}

const STAFF_NAV: NavItem[] = [
  { href: '/desk', label: 'Maurílio Desk', permission: 'dashboard:admin' },
  { href: '/clients', label: 'Clientes', permission: 'clients:read' },
  { href: '/demands', label: 'Demandas', permission: 'work:read' },
  { href: '/tasks', label: 'Tarefas', permission: 'tasks:read' },
  { href: '/approvals', label: 'Aprovações', permission: 'work:read' },
  { href: '/projects', label: 'Projetos', permission: 'work:read' },
  { href: '/calendar', label: 'Calendário', permission: 'work:read' },
  { href: '/files', label: 'Arquivos e marca', permission: 'files:read' },
  { href: '/agents', label: 'Agentes', permission: 'ai:read' },
  { href: '/agent-room', label: 'Agent Room', permission: 'ai:read' },
  { href: '/memory', label: 'Memória', permission: 'ai:read' },
  { href: '/chat', label: 'Chat Global', permission: 'ai:chat' },
  { href: '/ai-settings', label: 'Orçamento de IA', permission: 'ai:settings' },
  { href: '/integrations', label: 'Integrações', permission: 'mcp:read' },
  { href: '/tool-calls', label: 'Ações das ferramentas', permission: 'mcp:read' },
  { href: '/workflows', label: 'Workflows', permission: 'workflows:manage' },
  { href: '/reports', label: 'Relatórios diários', permission: 'reports:read' },
  { href: '/proposals', label: 'Propostas', permission: 'proposals:read' },
  { href: '/contracts', label: 'Contratos', permission: 'contracts:read' },
  { href: '/finance', label: 'Financeiro', permission: 'finance:read' },
  { href: '/users', label: 'Equipe e acessos', permission: 'users:read' },
  { href: '/audit', label: 'Auditoria', permission: 'audit:read' },
  { href: '/settings', label: 'Configurações', permission: 'finance:approve' },
];

const CLIENT_NAV: NavItem[] = [
  { href: '/portal', label: 'Dashboard', permission: 'dashboard:client' },
  { href: '/demands', label: 'Demandas', permission: 'work:read' },
  { href: '/approvals', label: 'Aprovações', permission: 'work:read' },
  { href: '/calendar', label: 'Calendário', permission: 'work:read' },
  { href: '/files', label: 'Arquivos e marca', permission: 'files:read' },
  { href: '/reports', label: 'Relatórios', permission: 'reports:read' },
  { href: '/billing', label: 'Contrato e faturas', permission: 'billing:read' },
];

/** Contador de notificações não lidas (atualiza a cada minuto e ao trocar de página). */
function useUnread(pathname: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ count: number }>('/notifications/unread-count')
        .then((r) => alive && setCount(r.count))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);
  return count;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('aimos-theme');
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.dataset.theme = saved;
        setTheme(saved);
      }
    } catch {
      /* armazenamento indisponível: segue o sistema */
    }
  }, []);
  const toggle = () => {
    const current = theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem('aimos-theme', next);
    } catch {
      /* ignora */
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label="Alternar tema claro/escuro">
      Tema {theme === 'light' ? 'claro' : theme === 'dark' ? 'escuro' : 'do sistema'}
    </Button>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { me, loading, logout, can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = useUnread(pathname);

  useEffect(() => {
    if (!loading && !me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, me, pathname, router]);
  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !me) {
    return (
      <main className="ds-main" aria-busy="true">
        <Skeleton height={36} width={280} />
        <Skeleton height={120} />
      </main>
    );
  }

  const nav = (me.isStaff ? STAFF_NAV : CLIENT_NAV).filter((i) => !i.permission || can(i.permission));
  const roleLabel = me.user.globalRole ?? me.memberships[0]?.roleKey ?? '';

  return (
    <div className="ds-shell">
      <div className="ds-topbar">
        <span className="ds-brand" style={{ padding: 0 }}>
          <span className="ds-brand-mark" /> Marketing OS
        </span>
        <Button size="sm" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-controls="sidebar">
          Menu{unread > 0 ? ` (${unread > 99 ? '99+' : unread})` : ''}
        </Button>
      </div>
      <nav id="sidebar" className="ds-sidebar" data-open={menuOpen} aria-label="Navegação principal">
        <div className="ds-brand">
          <span className="ds-brand-mark" />
          <span>Marketing OS</span>
        </div>
        {menuOpen && (
          <Button size="sm" variant="ghost" onClick={() => setMenuOpen(false)}>
            Fechar menu
          </Button>
        )}
        <Link href="/notifications" className="ds-nav-link" aria-current={pathname.startsWith('/notifications') ? 'page' : undefined}>
          Notificações{' '}
          {unread > 0 && (
            <span className="ds-badge ds-badge-info" aria-label={`${unread} não lidas`}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className="ds-nav-link" aria-current={pathname.startsWith(item.href) ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
        <div className="ds-sidebar-foot">
          <div className="ds-row" style={{ gap: 10 }}>
            <Avatar name={me.user.name} />
            <div className="ds-stack" style={{ gap: 0, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.user.name}</span>
              <span className="ds-eyebrow">{roleLabel}</span>
            </div>
          </div>
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sair
          </Button>
        </div>
      </nav>
      <main className="ds-main">{children}</main>
    </div>
  );
}
