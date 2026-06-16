import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock axios and api
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

vi.mock('@/hooks/useAuth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/hooks/useAuth')>()
  return {
    ...mod,
    useAuth: () => ({
      user: { id: '1', name: 'Test', email: 'test@test.com', role: 'admin', is_active: true, created_at: '' },
      isLoading: false,
      isAdmin: true,
      login: vi.fn(),
      logout: vi.fn(),
    }),
    AuthContext: mod.AuthContext,
  }
})

function wrapper(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  )
}

describe('Login Page', () => {
  it('renders login form', async () => {
    const { Login } = await import('@/pages/Login')
    wrapper(<Login />)
    expect(screen.getByLabelText(/e-mail/i)).toBeTruthy()
    expect(screen.getByLabelText(/senha/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeTruthy()
  })
})

describe('Dashboard Page', () => {
  it('renders without crash', async () => {
    vi.mocked((await import('@/lib/api')).default.get).mockResolvedValueOnce({
      data: { os_abertas: 0, os_em_producao: 0, os_prontas: 0, clientes_total: 0, faturamento_mes: 0, recent_os: [] },
    })
    const { Dashboard } = await import('@/pages/Dashboard')
    const { container } = wrapper(<Dashboard />)
    expect(container).toBeTruthy()
  })
})

describe('Client List', () => {
  it('renders without crash', async () => {
    const { ClientList } = await import('@/pages/clients/ClientList')
    const { container } = wrapper(<ClientList isReseller={false} />)
    expect(container).toBeTruthy()
  })
})

describe('Quote List', () => {
  it('renders without crash', async () => {
    const { QuoteList } = await import('@/pages/quotes/QuoteList')
    const { container } = wrapper(<QuoteList />)
    expect(container).toBeTruthy()
  })
})

describe('Service Order List', () => {
  it('renders without crash', async () => {
    const { ServiceOrderList } = await import('@/pages/service-orders/ServiceOrderList')
    const { container } = wrapper(<ServiceOrderList />)
    expect(container).toBeTruthy()
  })
})
