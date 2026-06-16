import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, downloadBlob } from '@/lib/utils'
import { quoteSchema, type QuoteFormData } from '@/lib/validators'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { Plus, Trash2, FileDown, ArrowRight, Save } from 'lucide-react'
import type { Client, Product } from '@/types'

export function QuoteForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!id

  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ['clients-all'], queryFn: async () => (await api.get('/clients/', { params: { limit: 500 } })).data })
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products/', { params: { limit: 500 } })).data })

  const { data: quote } = useQuery({
    queryKey: ['quote', id],
    queryFn: async () => (await api.get(`/quotes/${id}`)).data,
    enabled: isEditing,
  })

  const form = useForm<QuoteFormData>({
    resolver: zodResolver(quoteSchema),
    defaultValues: { client_id: '', discount_general: 0, status: 'aberto', items: [] },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' })
  const watchItems = form.watch('items')
  const watchDiscount = form.watch('discount_general')
  const watchClientId = form.watch('client_id')

  useEffect(() => {
    if (quote) {
      form.reset({
        client_id: quote.client_id,
        valid_until: quote.valid_until ?? '',
        discount_general: Number(quote.discount_general),
        notes: quote.notes ?? '',
        status: quote.status,
        items: quote.items.map((i: any) => ({
          product_id: i.product_id,
          width_m: i.width_m ? Number(i.width_m) : undefined,
          height_m: i.height_m ? Number(i.height_m) : undefined,
          quantity: i.quantity,
          unit_price: Number(i.unit_price),
          discount_pct: Number(i.discount_pct),
        })),
      })
    }
  }, [quote])

  const selectedClient = clients.find((c) => c.id === watchClientId)

  function getUnitPrice(productId: string) {
    const p = products.find((pr) => pr.id === productId)
    if (!p) return 0
    return selectedClient?.is_reseller ? Number(p.price_reseller) : Number(p.price_client)
  }

  function calcSubtotal(idx: number) {
    const item = watchItems[idx]
    if (!item) return 0
    const w = Number(item.width_m) || 0
    const h = Number(item.height_m) || 0
    const area = w > 0 && h > 0 ? w * h : 1
    return Number(item.unit_price) * area * Number(item.quantity) * (1 - Number(item.discount_pct) / 100)
  }

  const subtotal = watchItems.reduce((sum, _, idx) => sum + calcSubtotal(idx), 0)
  const grandTotal = subtotal * (1 - Number(watchDiscount) / 100)

  const mutation = useMutation({
    mutationFn: async (data: QuoteFormData) => {
      const payload = {
        ...data,
        items: data.items.map((item, idx) => ({
          ...item,
          area_m2: item.width_m && item.height_m ? item.width_m * item.height_m : undefined,
          subtotal: calcSubtotal(idx),
        })),
      }
      if (isEditing) return api.put(`/quotes/${id}`, payload)
      return api.post('/quotes/', payload)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast({ title: isEditing ? 'Orçamento atualizado!' : 'Orçamento criado!' })
      if (!isEditing) navigate(`/orcamentos/${res.data.id}`)
    },
    onError: () => toast({ title: 'Erro ao salvar', variant: 'destructive' }),
  })

  const convertMutation = useMutation({
    mutationFn: () => api.post(`/quotes/${id}/convert-to-os`),
    onSuccess: (res) => navigate(`/ordens-de-servico/${res.data.os_id}`),
    onError: () => toast({ title: 'Erro ao converter', variant: 'destructive' }),
  })

  async function downloadPdf() {
    try {
      const res = await api.get(`/pdf/quote/${id}`, { responseType: 'blob' })
      downloadBlob(res.data, `orcamento-${id}.pdf`)
    } catch { toast({ title: 'Erro ao gerar PDF', variant: 'destructive' }) }
  }

  return (
    <div>
      <PageHeader title={isEditing ? 'Editar Orçamento' : 'Novo Orçamento'}>
        <div className="flex gap-2">
          {isEditing && <Button variant="outline" onClick={downloadPdf}><FileDown className="mr-2 h-4 w-4" />PDF</Button>}
          {isEditing && quote?.status === 'aprovado' && (
            <Button variant="outline" onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
              <ArrowRight className="mr-2 h-4 w-4" />Converter em OS
            </Button>
          )}
          <Button onClick={form.handleSubmit((d) => mutation.mutate(d))} disabled={mutation.isPending}>
            <Save className="mr-2 h-4 w-4" />{mutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Dados Gerais</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('client_id')}>
                <option value="">Selecione...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {form.formState.errors.client_id && <p className="text-sm text-destructive">{form.formState.errors.client_id.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('status')}>
                {['aberto', 'aprovado', 'recusado', 'expirado'].map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Validade</Label>
              <Input type="date" {...form.register('valid_until')} />
            </div>
            <div className="space-y-2">
              <Label>Desconto Geral (%)</Label>
              <Input type="number" min="0" max="100" step="0.01" {...form.register('discount_general', { valueAsNumber: true })} />
            </div>
            <div className="space-y-2 md:col-span-2 lg:col-span-4">
              <Label>Observações</Label>
              <textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('notes')} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Itens do Orçamento</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ product_id: '', quantity: 1, unit_price: 0, discount_pct: 0 })}>
              <Plus className="mr-2 h-4 w-4" />Adicionar Item
            </Button>
          </CardHeader>
          <CardContent>
            {form.formState.errors.items && typeof form.formState.errors.items === 'object' && !Array.isArray(form.formState.errors.items) && (
              <p className="text-sm text-destructive mb-2">{(form.formState.errors.items as any).message}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left p-2">Produto</th>
                  <th className="p-2 w-24">Larg.(m)</th>
                  <th className="p-2 w-24">Alt.(m)</th>
                  <th className="p-2 w-24">Área(m²)</th>
                  <th className="p-2 w-20">Qtd</th>
                  <th className="p-2 w-32">Preço Unit.</th>
                  <th className="p-2 w-20">Desc.%</th>
                  <th className="p-2 w-32 text-right">Subtotal</th>
                  <th className="p-2 w-10"></th>
                </tr></thead>
                <tbody>
                  {fields.map((field, idx) => {
                    const w = Number(form.watch(`items.${idx}.width_m`)) || 0
                    const h = Number(form.watch(`items.${idx}.height_m`)) || 0
                    const area = w > 0 && h > 0 ? (w * h).toFixed(4) : '-'
                    return (
                      <tr key={field.id} className="border-b">
                        <td className="p-2">
                          <select className="w-full border rounded px-2 py-1" {...form.register(`items.${idx}.product_id`)}
                            onChange={(e) => {
                              form.setValue(`items.${idx}.product_id`, e.target.value)
                              const price = getUnitPrice(e.target.value)
                              form.setValue(`items.${idx}.unit_price`, price)
                            }}>
                            <option value="">Selecione...</option>
                            {products.filter(p => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td className="p-2"><Input type="number" step="0.01" className="h-8" {...form.register(`items.${idx}.width_m`, { valueAsNumber: true })} /></td>
                        <td className="p-2"><Input type="number" step="0.01" className="h-8" {...form.register(`items.${idx}.height_m`, { valueAsNumber: true })} /></td>
                        <td className="p-2 text-center text-muted-foreground">{area}</td>
                        <td className="p-2"><Input type="number" min="1" className="h-8" {...form.register(`items.${idx}.quantity`, { valueAsNumber: true })} /></td>
                        <td className="p-2"><Input type="number" step="0.01" className="h-8" {...form.register(`items.${idx}.unit_price`, { valueAsNumber: true })} /></td>
                        <td className="p-2"><Input type="number" min="0" max="100" step="0.01" className="h-8" {...form.register(`items.${idx}.discount_pct`, { valueAsNumber: true })} /></td>
                        <td className="p-2 text-right font-medium">{formatCurrency(calcSubtotal(idx))}</td>
                        <td className="p-2"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                      </tr>
                    )
                  })}
                  {!fields.length && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">Nenhum item adicionado</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-4"><span className="text-muted-foreground">Subtotal:</span><span className="font-medium">{formatCurrency(subtotal)}</span></div>
              {Number(watchDiscount) > 0 && <div className="flex gap-4 text-red-600"><span>Desconto ({watchDiscount}%):</span><span>- {formatCurrency(subtotal * Number(watchDiscount) / 100)}</span></div>}
              <div className="flex gap-4 text-lg font-bold text-primary"><span>TOTAL:</span><span>{formatCurrency(grandTotal)}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
