import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { PageLoading } from '@/components/LoadingSpinner'
import { OSStatusBadge } from '@/components/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ClipboardList, Users, DollarSign, AlertTriangle, Clock, CheckSquare } from 'lucide-react'

interface DashboardData {
  os_abertas: number
  os_em_producao: number
  os_prontas: number
  clientes_total: number
  faturamento_mes: number
  inadimplencia_total?: number
  recent_os: Array<{ id: string; number: number; client_name: string; status: string; total_value: number; opened_at: string }>
}

export function Dashboard() {
  const { isAdmin } = useAuth()

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard/')
      return res.data
    },
  })

  if (isLoading) return <PageLoading />
  if (error) return <div className="p-8 text-red-500">Erro ao carregar dashboard.</div>

  const cards = [
    { label: 'OS Abertas', value: data?.os_abertas ?? 0, icon: ClipboardList, color: 'text-blue-600' },
    { label: 'Em Produção', value: data?.os_em_producao ?? 0, icon: Clock, color: 'text-yellow-600' },
    { label: 'Prontas p/ Entrega', value: data?.os_prontas ?? 0, icon: CheckSquare, color: 'text-orange-600' },
    { label: 'Clientes Ativos', value: data?.clientes_total ?? 0, icon: Users, color: 'text-green-600' },
    { label: 'Faturamento do Mês', value: formatCurrency(data?.faturamento_mes ?? 0), icon: DollarSign, color: 'text-green-700', isMonetary: true },
    ...(isAdmin ? [{ label: 'Inadimplência Total', value: formatCurrency(data?.inadimplencia_total ?? 0), icon: AlertTriangle, color: 'text-red-700', isMonetary: true, danger: true }] : []),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral do sistema</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className={c.danger ? 'border-red-200 bg-red-50' : ''}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`h-5 w-5 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Ordens de Serviço Recentes</h2>
        <Card>
          <CardContent className="p-0">
            {!data?.recent_os?.length ? (
              <p className="p-6 text-center text-muted-foreground">Nenhum registro encontrado</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº OS</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent_os.map((os) => (
                    <TableRow key={os.id}>
                      <TableCell>
                        <Link to={`/ordens-de-servico/${os.id}`} className="text-primary hover:underline font-medium">
                          #{String(os.number).padStart(5, '0')}
                        </Link>
                      </TableCell>
                      <TableCell>{os.client_name}</TableCell>
                      <TableCell><OSStatusBadge status={os.status} /></TableCell>
                      <TableCell>{formatDate(os.opened_at)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(os.total_value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
