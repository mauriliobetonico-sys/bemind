import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { receiptSchema, type ReceiptFormData } from '@/lib/validators'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Save, FileDown } from 'lucide-react'
import type { Client, ConfigList, Receipt, ServiceOrder } from '@/types'

export function ReceiptForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const isEditing = !!id
  const prefilledOsId = searchParams.get('os_id')
  const [amountWords, setAmountWords] = useState('')

  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ['clients-all'], queryFn: async () => (await api.get('/clients', { params: { limit: 200 } })).data })
  const { data: paymentMethods = [] } = useQuery<ConfigList[]>({ queryKey: ['config', 'payment_method'], queryFn: async () => (await api.get('/config', { params: { category: 'payment_method' } })).data })
  const { data: receipt } = useQuery<Receipt>({ queryKey: ['receipt', id], queryFn: async () => (await api.get(`/receipts/${id}`)).data, enabled: isEditing })
  const { data: osData } = useQuery<ServiceOrder>({ queryKey: ['service-order-prefill', prefilledOsId], queryFn: async () => (await api.get(`/service-orders/${prefilledOsId}`)).data, enabled: !!prefilledOsId && !isEditing })

  const form = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptSchema),
    defaultValues: { client_id: '', payer_name: '', amount: 0, reference: '', payment_method: '', receipt_date: new Date().toISOString().slice(0, 10) },
  })

  useEffect(() => {
    if (osData) {
      form.setValue('client_id', osData.client_id)
      form.setValue('payer_name', osData.client?.name ?? '')
      form.setValue('amount', Number(osData.total_value))
      form.setValue('reference', `OS #${String(osData.number).padStart(5, '0')}`)
      form.setValue('os_id', osData.id)
    }
  }, [osData])

  useEffect(() => {
    if (receipt) {
      form.reset({ client_id: receipt.client_id, os_id: receipt.os_id ?? undefined, payer_name: receipt.payer_name, amount: Number(receipt.amount), reference: receipt.reference, payment_method: receipt.payment_method, receipt_date: String(receipt.receipt_date) })
      setAmountWords(receipt.amount_words)
    }
  }, [receipt])

  async function fetchAmountWords(value: number) {
    if (!value || value <= 0) return
    try {
      const res = await api.get('/receipts/amount-words', { params: { value } })
      setAmountWords(res.data.words)
    } catch {}
  }

  const mutation = useMutation({
    mutationFn: (data: ReceiptFormData) => api.post('/receipts', data),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['receipts'] }); toast({ title: 'Recibo criado!' }); navigate(`/recibos/${res.data.id}`) },
    onError: () => toast({ title: 'Erro ao criar recibo', variant: 'destructive' }),
  })

  function openPdf() {
    window.open(`/api/v1/pdf/html/receipt/${id}`, '_blank')
  }

  return (
    <div>
      <PageHeader title={isEditing ? `Recibo #${String(receipt?.number ?? '').padStart(5, '0')}` : 'Novo Recibo'}>
        {isEditing && <Button variant="outline" onClick={openPdf}><FileDown className="mr-2 h-4 w-4" />PDF</Button>}
        {!isEditing && (
          <Button onClick={form.handleSubmit((d) => mutation.mutate(d))} disabled={mutation.isPending}>
            <Save className="mr-2 h-4 w-4" />{mutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Dados do Recibo</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Cliente *</Label>
            <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('client_id')} disabled={isEditing}>
              <option value="">Selecione...</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {form.formState.errors.client_id && <p className="text-sm text-destructive">{form.formState.errors.client_id.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Nome do Pagador *</Label>
            <Input readOnly={isEditing} {...form.register('payer_name')} />
            {form.formState.errors.payer_name && <p className="text-sm text-destructive">{form.formState.errors.payer_name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Valor (R$) *</Label>
            <Input type="number" step="0.01" readOnly={isEditing} {...form.register('amount', { valueAsNumber: true })}
              onBlur={(e) => fetchAmountWords(Number(e.target.value))} />
            {amountWords && <p className="text-sm text-muted-foreground italic capitalize">{amountWords}</p>}
          </div>
          <div className="space-y-2">
            <Label>Referência *</Label>
            <Input readOnly={isEditing} {...form.register('reference')} placeholder="Ex: OS #00001, serviço prestado..." />
          </div>
          <div className="space-y-2">
            <Label>Forma de Pagamento *</Label>
            <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('payment_method')} disabled={isEditing}>
              <option value="">Selecione...</option>
              {paymentMethods.map((m) => <option key={m.id} value={m.value}>{m.value}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Data do Recibo *</Label>
            <Input type="date" readOnly={isEditing} {...form.register('receipt_date')} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
