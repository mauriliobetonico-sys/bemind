import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthContext, useAuthState } from '@/hooks/useAuth'
import { Layout } from '@/components/Layout'
import { Toaster } from '@/components/Toaster'
import { PageLoading } from '@/components/LoadingSpinner'

import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { ClientList } from '@/pages/clients/ClientList'
import { ClientForm } from '@/pages/clients/ClientForm'
import { ProductList } from '@/pages/products/ProductList'
import { QuoteList } from '@/pages/quotes/QuoteList'
import { QuoteForm } from '@/pages/quotes/QuoteForm'
import { ServiceOrderList } from '@/pages/service-orders/ServiceOrderList'
import { ServiceOrderForm } from '@/pages/service-orders/ServiceOrderForm'
import { ReceiptList } from '@/pages/receipts/ReceiptList'
import { ReceiptForm } from '@/pages/receipts/ReceiptForm'
import { AccountsReceivable } from '@/pages/financial/AccountsReceivable'
import { CashFlow } from '@/pages/financial/CashFlow'
import { ClientDebt } from '@/pages/financial/ClientDebt'
import { Reports } from '@/pages/reports/Reports'
import { SettingsPage } from '@/pages/settings/Settings'

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, isLoading, isAdmin } = useAuthState()
  if (isLoading) return <PageLoading />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { user, isLoading, isAdmin } = useAuthState()

  if (isLoading) return <PageLoading />

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={
        user ? (
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clientes" element={<ClientList isReseller={false} />} />
              <Route path="/clientes/novo" element={<ClientForm isReseller={false} />} />
              <Route path="/clientes/:id" element={<ClientForm isReseller={false} />} />
              <Route path="/revendedores" element={<ClientList isReseller={true} />} />
              <Route path="/revendedores/novo" element={<ClientForm isReseller={true} />} />
              <Route path="/revendedores/:id" element={<ClientForm isReseller={true} />} />
              <Route path="/produtos" element={<ProductList />} />
              <Route path="/orcamentos" element={<QuoteList />} />
              <Route path="/orcamentos/novo" element={<QuoteForm />} />
              <Route path="/orcamentos/:id" element={<QuoteForm />} />
              <Route path="/ordens-de-servico" element={<ServiceOrderList />} />
              <Route path="/ordens-de-servico/nova" element={<ServiceOrderForm />} />
              <Route path="/ordens-de-servico/:id" element={<ServiceOrderForm />} />
              <Route path="/recibos" element={<ReceiptList />} />
              <Route path="/recibos/novo" element={<ReceiptForm />} />
              <Route path="/recibos/:id" element={<ReceiptForm />} />
              <Route path="/financeiro/contas-a-receber" element={isAdmin ? <AccountsReceivable /> : <Navigate to="/" />} />
              <Route path="/financeiro/caixa" element={isAdmin ? <CashFlow /> : <Navigate to="/" />} />
              <Route path="/financeiro/divida-cliente" element={isAdmin ? <ClientDebt /> : <Navigate to="/" />} />
              <Route path="/relatorios" element={isAdmin ? <Reports /> : <Navigate to="/" />} />
              <Route path="/configuracoes" element={isAdmin ? <SettingsPage /> : <Navigate to="/" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        ) : <Navigate to="/login" replace />
      } />
    </Routes>
  )
}

export default function App() {
  const authState = useAuthState()
  return (
    <AuthContext.Provider value={authState}>
      <BrowserRouter>
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
