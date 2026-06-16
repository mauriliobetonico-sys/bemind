import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { Plus, TrendingUp, TrendingDown, DollarSign } from 'lucide-react'
import type { CashFlow as CashFlowType } from '@/types'

export function CashFlow() {
  const qc = useQueryClient()
  const now = new Date()
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
  const [dateTo, setDateTo] = useState(now.toISOString().slice(0, 10))
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'entrada', category: '', description: '', amount: '', date: now.toISOString().slice(0, 10) })

  const { data = [], isLoading } = useQuery<CashFlowType[]>({
    queryKey: ['cashflow', dateFrom, dateTo],
    queryFn: async () => (await api.get('/financial/cash-flow', { params: { date_from: dateFrom, date_to: dateTo, limit: 200 } })).data,
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/financial/cash-flow', { ...form, amount: Number(form.amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cashflow'] }); toast({ title: 'Lançamento criado!' }); setShowForm(false); setForm({ type: 'entrada', category: '', description: '', amount: '', date: now.toISOString().slice(0, 10) }) },
    onError: () => toast({ title: 'Erro ao criar lançamento', variant: 'destructive' }),
  })

  const entradas = data.filter(c => c.type === 'entrada').reduce((s, c) => s + Number(c.amount), 0)
  const saidas = data.filter(c => c.type === 'saida').reduce((s, c) => s + Number(c.amount), 0)

  if (isLoading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Caixa / Fluxo de Caixa">
        <Button onClick={() => setShowForm(true)}><Plus className="mr-2 h-4 w-4" />Novo Lançamento</Button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4 text-green-600" />Entradas</CardTitle></CardHeader><CardContent><p className="text-xl font-bold text-green-600">{formatCurrency(entradas)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><TrendingDown className="h-4 w-4 text-red-600" />Saídas</CardTitle></CardHeader><CardContent><p className="text-xl font-bold text-red-600">{formatCurrency(saidas)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" />Saldo</CardTitle></CardHeader><CardContent><p className={`text-xl font-bold ${entradas - saidas >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(entradas - saidas)}</p></CardContent></Card>
      </div>

      <div className="flex gap-4 mb-4">
        <div className="space-y-1"><Label className="text-xs">De</Label><Input type="date" className="h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Até</Label><Input type="date" className="h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data.length ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum lançamento no período</TableCell></TableRow>
            ) : data.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{formatDate(c.date)}</TableCell>
                <TableCell><Badge variant={c.type === 'entrada' ? 'success' : 'destructive'}>{c.type === 'entrada' ? 'Entrada' : 'Saída'}</Badge></TableCell>
                <TableCell>{c.category}</TableCell>
                <TableCell>{c.description}</TableCell>
                <TableCell className={`text-right font-medium ${c.type === 'entrada' ? 'text-green-600' : 'text-red-600'}`}>
                  {c.type === 'saida' ? '- ' : ''}{formatCurrency(c.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Lançamento</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Tipo</Label>
              <select className="flex h-10 w-full rounded-md border px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
              </select></div>
            <div className="space-y-2"><Label>Categoria</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ex: Material, Mão de obra, Vendas..." /></div>
            <div className="space-y-2"><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-2"><Label>Valor (R$)</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="space-y-2"><Label>Data</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>{createMutation.isPending ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
