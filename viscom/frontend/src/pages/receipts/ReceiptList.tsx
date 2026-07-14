import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, FileDown, Eye } from 'lucide-react'
import type { Receipt } from '@/types'

export function ReceiptList() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery<Receipt[]>({
    queryKey: ['receipts'],
    queryFn: async () => (await api.get('/receipts', { params: { limit: 100 } })).data,
  })

  function openPdf(id: string) {
    window.open(`/api/v1/pdf/html/receipt/${id}`, '_blank')
  }

  if (isLoading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Recibos" subtitle="Gerencie os recibos emitidos">
        <Button onClick={() => navigate('/recibos/novo')}><Plus className="mr-2 h-4 w-4" /> Novo Recibo</Button>
      </PageHeader>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>OS</TableHead>
              <TableHead>Pagador</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum recibo encontrado</TableCell></TableRow>
            ) : data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono font-medium">#{String(r.number).padStart(5, '0')}</TableCell>
                <TableCell>{r.client?.name ?? '-'}</TableCell>
                <TableCell>{r.os_id ? `#${String((r as any).os?.number ?? '').padStart(5, '0')}` : '-'}</TableCell>
                <TableCell>{r.payer_name}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(r.amount)}</TableCell>
                <TableCell>{formatDate(r.receipt_date)}</TableCell>
                <TableCell>{r.payment_method}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => navigate(`/recibos/${r.id}`)} title="Ver"><Eye className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => openPdf(r.id)} title="PDF"><FileDown className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
