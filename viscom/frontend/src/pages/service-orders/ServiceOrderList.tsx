import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { OSStatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { Plus, Edit, FileDown, Trash2 } from 'lucide-react'
import type { ServiceOrder } from '@/types'

const STATUSES = ['', 'aberta', 'em_producao', 'pronta', 'instalada', 'finalizada']
const STATUS_LABELS: Record<string, string> = {
  '': 'Todas', aberta: 'Abertas', em_producao: 'Em Produção',
  pronta: 'Prontas', instalada: 'Instaladas', finalizada: 'Finalizadas',
}

export function ServiceOrderList() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState('')

  const { data, isLoading } = useQuery<ServiceOrder[]>({
    queryKey: ['service-orders', status],
    queryFn: async () => {
      const res = await api.get('/service-orders', { params: { status: status || undefined, limit: 100 } })
      return res.data
    },
  })

  function openPdf(id: string) {
    window.open(`/api/v1/pdf/html/service-order/${id}`, '_blank')
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/service-orders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-orders'] })
      toast({ title: 'OS excluída com sucesso.' })
    },
    onError: () => toast({ title: 'Erro ao excluir OS.', variant: 'destructive' }),
  })

  function handleDelete(os: ServiceOrder) {
    if (!confirm(`Excluir OS #${String(os.number).padStart(5, '0')}? Esta ação não pode ser desfeita.`)) return
    deleteMutation.mutate(os.id)
  }

  if (isLoading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Ordens de Serviço" subtitle="Gerencie a produção">
        <Button onClick={() => navigate('/ordens-de-servico/nova')}>
          <Plus className="mr-2 h-4 w-4" /> Nova OS
        </Button>
      </PageHeader>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.map((s) => (
          <Button key={s} variant={status === s ? 'default' : 'outline'} size="sm" onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº OS</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Abertura</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhuma OS encontrada</TableCell></TableRow>
            ) : data.map((os) => (
              <TableRow key={os.id}>
                <TableCell className="font-mono font-medium">#{String(os.number).padStart(5, '0')}</TableCell>
                <TableCell>{os.client?.name ?? '-'}</TableCell>
                <TableCell>{formatDate(os.opened_at)}</TableCell>
                <TableCell>{os.deadline ? <span className={new Date(os.deadline) < new Date() && os.status !== 'finalizada' ? 'text-red-600 font-medium' : ''}>{formatDate(os.deadline)}</span> : '-'}</TableCell>
                <TableCell><OSStatusBadge status={os.status} /></TableCell>
                <TableCell>{os.created_by?.name ?? '-'}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(os.total_value)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => navigate(`/ordens-de-servico/${os.id}`)} title="Editar"><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openPdf(os.id)} title="PDF"><FileDown className="h-4 w-4" /></Button>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(os)} title="Excluir" disabled={deleteMutation.isPending}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
