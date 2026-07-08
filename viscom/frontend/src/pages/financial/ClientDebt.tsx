import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { ReceivableStatusBadge } from '@/components/StatusBadge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Client, Receivable } from '@/types'

export function ClientDebt() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients-search', search],
    queryFn: async () => (await api.get('/clients', { params: { search: search || undefined, limit: 20 } })).data,
    enabled: search.length >= 2,
  })

  const { data: receivables = [] } = useQuery<Receivable[]>({
    queryKey: ['client-debt', selectedId],
    queryFn: async () => (await api.get('/financial/receivables', { params: { client_id: selectedId, status: 'pending,partial,overdue', limit: 200 } })).data,
    enabled: !!selectedId,
  })

  const selected = clients.find(c => c.id === selectedId)
  const totalDebt = receivables.reduce((s, r) => s + (Number(r.total_value) - Number(r.paid_amount)), 0)
  const overdueDebt = receivables.filter(r => r.status === 'overdue').reduce((s, r) => s + (Number(r.total_value) - Number(r.paid_amount)), 0)

  return (
    <div>
      <PageHeader title="Dívida por Cliente" subtitle="Consulte o saldo devedor de um cliente" />
      <div className="mb-6 max-w-lg">
        <Input placeholder="Buscar cliente por nome ou CPF/CNPJ..." value={search} onChange={(e) => { setSearch(e.target.value); setSelectedId('') }} />
        {clients.length > 0 && !selectedId && (
          <div className="border rounded-md mt-1 bg-white shadow-lg z-10">
            {clients.map(c => (
              <button key={c.id} className="w-full text-left px-4 py-2 hover:bg-accent text-sm" onClick={() => { setSelectedId(c.id); setSearch(c.name) }}>{c.name} — {c.cpf_cnpj}</button>
            ))}
          </div>
        )}
      </div>

      {selectedId && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total em Aberto</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-orange-600">{formatCurrency(totalDebt)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Vencido</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-red-600">{formatCurrency(overdueDebt)}</p></CardContent>
            </Card>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!receivables.length ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma dívida em aberto</TableCell></TableRow>
                ) : receivables.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.description}</TableCell>
                    <TableCell>{r.installment_number}/{r.total_installments}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.total_value)}</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(r.paid_amount)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(Number(r.total_value) - Number(r.paid_amount))}</TableCell>
                    <TableCell className={new Date(r.due_date) < new Date() ? 'text-red-600 font-medium' : ''}>{formatDate(r.due_date)}</TableCell>
                    <TableCell><ReceivableStatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
