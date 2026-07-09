import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, formatDate, downloadBlob } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { QuoteStatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { Plus, Edit, FileDown, ArrowRight, Trash2, CheckCircle } from 'lucide-react'
import type { Quote } from '@/types'

const STATUSES = ['', 'aberto', 'aprovado', 'recusado', 'expirado']
const LABELS: Record<string, string> = { '': 'Todos', aberto: 'Abertos', aprovado: 'Aprovados', recusado: 'Recusados', expirado: 'Expirados' }

export function QuoteList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<Quote[]>({
    queryKey: ['quotes', status],
    queryFn: async () => {
      const res = await api.get('/quotes', { params: { status: status || undefined, limit: 100 } })
      return res.data
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/quotes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotes'] }); toast({ title: 'Orçamento excluído' }); setDeleteId(null) },
    onError: () => toast({ title: 'Erro ao excluir', variant: 'destructive' }),
  })

  const convertMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quotes/${id}/convert-to-os`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast({ title: 'OS criada com sucesso!', variant: 'default' })
      navigate(`/ordens-de-servico/${res.data.os_id}`)
    },
    onError: (e: any) => toast({ title: e?.response?.data?.detail ?? 'Erro ao converter em OS', variant: 'destructive' }),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/quotes/${id}`, { status: 'aprovado' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotes'] }); toast({ title: 'Orçamento aprovado!' }) },
    onError: () => toast({ title: 'Erro ao aprovar', variant: 'destructive' }),
  })

  async function downloadPdf(id: string, number: number) {
    try {
      const res = await api.get(`/pdf/quote/${id}`, { responseType: 'blob' })
      downloadBlob(res.data, `orcamento-${String(number).padStart(5, '0')}.pdf`)
    } catch (e: any) {
      toast({ title: 'Erro ao gerar PDF', variant: 'destructive' })
    }
  }

  if (isLoading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Orçamentos" subtitle="Gerencie seus orçamentos">
        <Button onClick={() => navigate('/orcamentos/novo')}>
          <Plus className="mr-2 h-4 w-4" /> Novo Orçamento
        </Button>
      </PageHeader>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.map((s) => (
          <Button key={s} variant={status === s ? 'default' : 'outline'} size="sm" onClick={() => setStatus(s)}>
            {LABELS[s]}
          </Button>
        ))}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhum orçamento encontrado</TableCell></TableRow>
            ) : data.map((q) => {
              const total = q.items?.reduce((s, i) => s + Number(i.subtotal), 0) * (1 - Number(q.discount_general) / 100)
              return (
                <TableRow key={q.id}>
                  <TableCell className="font-mono font-medium">#{String(q.number).padStart(5, '0')}</TableCell>
                  <TableCell>{q.client?.name ?? '-'}</TableCell>
                  <TableCell>{formatDate(q.created_at)}</TableCell>
                  <TableCell>{q.valid_until ? formatDate(q.valid_until) : '-'}</TableCell>
                  <TableCell><QuoteStatusBadge status={q.status} /></TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(total)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => navigate(`/orcamentos/${q.id}`)} title="Editar">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => downloadPdf(q.id, q.number)} title="Gerar PDF">
                        <FileDown className="h-4 w-4" />
                      </Button>
                      {q.status !== 'aprovado' && q.status !== 'recusado' && (
                        <Button variant="ghost" size="icon" onClick={() => approveMutation.mutate(q.id)} title="Aprovar" disabled={approveMutation.isPending}>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => convertMutation.mutate(q.id)} title="Converter em OS" disabled={convertMutation.isPending}>
                        <ArrowRight className="h-4 w-4 text-blue-600" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(q.id)} title="Excluir">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!deleteId} onOpenChange={() => setDeleteId(null)}
        title="Excluir Orçamento" description="Tem certeza que deseja excluir este orçamento?"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending} confirmLabel="Excluir"
      />
    </div>
  )
}
