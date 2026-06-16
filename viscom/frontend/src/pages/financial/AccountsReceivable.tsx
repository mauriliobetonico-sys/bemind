import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { ReceivableStatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { DollarSign } from 'lucide-react'
import type { Receivable, ConfigList } from '@/types'

export function AccountsReceivable() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState('')

  const { data: paymentMethods = [] } = useQuery<ConfigList[]>({ queryKey: ['config', 'payment_method'], queryFn: async () => (await api.get('/config/', { params: { category: 'payment_method' } })).data })

  const { data, isLoading } = useQuery<Receivable[]>({
    queryKey: ['receivables', statusFilter, dateFrom, dateTo],
    queryFn: async () => {
      const res = await api.get('/financial/receivables', { params: { status: statusFilter || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, limit: 200 } })
      return res.data
    },
  })

  const payingReceivable = data?.find((r) => r.id === payingId)
  const maxPay = payingReceivable ? Number(payingReceivable.total_value) - Number(payingReceivable.paid_amount) : 0

  const payMutation = useMutation({
    mutationFn: () => api.post(`/financial/receivables/${payingId}/payments`, {
      amount: Number(payAmount),
      payment_date: payDate,
      payment_method: payMethod,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      toast({ title: 'Pagamento registrado!' })
      setPayingId(null)
      setPayAmount('')
    },
    onError: () => toast({ title: 'Erro ao registrar pagamento', variant: 'destructive' }),
  })

  const totalAReceber = data?.reduce((s, r) => s + (Number(r.total_value) - Number(r.paid_amount)), 0) ?? 0
  const totalRecebido = data?.reduce((s, r) => s + Number(r.paid_amount), 0) ?? 0
  const totalVencido = data?.filter(r => r.status === 'overdue').reduce((s, r) => s + (Number(r.total_value) - Number(r.paid_amount)), 0) ?? 0

  if (isLoading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Contas a Receber" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total a Receber', value: totalAReceber, color: 'text-blue-600' },
          { label: 'Recebido', value: totalRecebido, color: 'text-green-600' },
          { label: 'Em Aberto', value: totalAReceber, color: 'text-yellow-600' },
          { label: 'Vencido', value: totalVencido, color: 'text-red-600' },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{c.label}</CardTitle></CardHeader>
            <CardContent><p className={`text-xl font-bold ${c.color}`}>{formatCurrency(c.value)}</p></CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-4 mb-4 flex-wrap items-end">
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <select className="h-9 border rounded px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="pending">Pendente</option>
            <option value="partial">Parcial</option>
            <option value="paid">Pago</option>
            <option value="overdue">Vencido</option>
          </select>
        </div>
        <div className="space-y-1"><Label className="text-xs">De</Label><Input type="date" className="h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Até</Label><Input type="date" className="h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Parcela</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhum lançamento encontrado</TableCell></TableRow>
            ) : data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.client?.name ?? '-'}</TableCell>
                <TableCell className="max-w-[200px] truncate">{r.description}</TableCell>
                <TableCell>{r.installment_number}/{r.total_installments}</TableCell>
                <TableCell className="text-right">{formatCurrency(r.total_value)}</TableCell>
                <TableCell className="text-right text-green-600">{formatCurrency(r.paid_amount)}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(Number(r.total_value) - Number(r.paid_amount))}</TableCell>
                <TableCell className={new Date(r.due_date) < new Date() && r.status !== 'paid' ? 'text-red-600 font-medium' : ''}>{formatDate(r.due_date)}</TableCell>
                <TableCell><ReceivableStatusBadge status={r.status} /></TableCell>
                <TableCell className="text-right">
                  {r.status !== 'paid' && (
                    <Button size="sm" variant="outline" onClick={() => { setPayingId(r.id); setPayAmount(String(maxPay)) }}>
                      <DollarSign className="mr-1 h-3 w-3" />Pagar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!payingId} onOpenChange={() => setPayingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar Pagamento</DialogTitle></DialogHeader>
          {payingReceivable && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {payingReceivable.description} — Saldo: <strong>{formatCurrency(maxPay)}</strong>
              </p>
              <div className="space-y-2"><Label>Valor (R$) *</Label>
                <Input type="number" step="0.01" max={maxPay} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
              <div className="space-y-2"><Label>Data do Pagamento *</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
              <div className="space-y-2"><Label>Forma de Pagamento *</Label>
                <select className="flex h-10 w-full rounded-md border px-3 py-2 text-sm" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="">Selecione...</option>
                  {paymentMethods.map((m) => <option key={m.id} value={m.value}>{m.value}</option>)}
                </select></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingId(null)}>Cancelar</Button>
            <Button onClick={() => payMutation.mutate()} disabled={!payAmount || !payDate || !payMethod || payMutation.isPending}>
              {payMutation.isPending ? 'Salvando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
