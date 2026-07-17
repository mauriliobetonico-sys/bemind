import { ReactNode, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, UserCheck, Package, FileText, ClipboardList,
  Receipt, DollarSign, BarChart3, Settings, LogOut, Menu, X, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  adminOnly?: boolean
  children?: { label: string; href: string }[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Clientes', href: '/clientes', icon: Users },
  { label: 'Revendedores', href: '/revendedores', icon: UserCheck },
  { label: 'Produtos', href: '/produtos', icon: Package },
  { label: 'Orçamentos', href: '/orcamentos', icon: FileText },
  { label: 'Ordens de Serviço', href: '/ordens-de-servico', icon: ClipboardList },
  { label: 'Recibos', href: '/recibos', icon: Receipt },
  {
    label: 'Financeiro',
    href: '/financeiro',
    icon: DollarSign,
    adminOnly: true,
    children: [
      { label: 'Contas a Receber', href: '/financeiro/contas-a-receber' },
      { label: 'Caixa / Fluxo', href: '/financeiro/caixa' },
      { label: 'Dívida por Cliente', href: '/financeiro/divida-cliente' },
    ],
  },
  { label: 'Relatórios', href: '/relatorios', icon: BarChart3, adminOnly: true },
  { label: 'Configurações', href: '/configuracoes', icon: Settings, adminOnly: true },
]

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)

  if (item.adminOnly && !isAdmin) return null

  const isActive = location.pathname === item.href ||
    (item.href !== '/' && location.pathname.startsWith(item.href))
  const Icon = item.icon

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {!collapsed && <><span className="flex-1 text-left">{item.label}</span><ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /></>}
        </button>
        {open && !collapsed && (
          <div className="ml-7 mt-1 space-y-1">
            {item.children.map((c) => (
              <Link
                key={c.href}
                to={c.href}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm transition-colors',
                  location.pathname === c.href ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {c.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Link
      to={item.href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  )
}

interface Props { children: ReactNode }

export function Layout({ children }: Props) {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300 lg:static lg:z-auto',
        collapsed ? 'w-16' : 'w-64',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b px-4">
          {!collapsed && (
            <div>
              <p className="font-bold text-primary">VisCom</p>
              <p className="text-xs text-muted-foreground">Comunicação Visual</p>
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="hidden lg:block p-1 rounded hover:bg-accent">
            <Menu className="h-5 w-5" />
          </button>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden p-1 rounded hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} />
          ))}
        </nav>

        {/* User */}
        <div className="border-t p-2">
          <div className={cn('flex items-center gap-3 rounded-md px-3 py-2', !collapsed && 'mb-1')}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
              </div>
            )}
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
            title={collapsed ? 'Sair' : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && 'Sair'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="flex h-16 items-center border-b bg-card px-4 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded hover:bg-accent">
            <Menu className="h-5 w-5" />
          </button>
          <span className="ml-3 font-bold text-primary">VisCom</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
