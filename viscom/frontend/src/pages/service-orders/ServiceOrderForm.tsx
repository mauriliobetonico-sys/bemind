import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, formatDate, osStatusLabel, downloadBlob } from '@/lib/utils'
import { serviceOrderSchema, type ServiceOrderFormData } from '@/lib/validators'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { Plus, Trash2, FileDown, Receipt, Save } from 'lucide-react'
import type { Client, Product, ConfigList, ServiceOrder } from '@/types'

const OS_STATUSES = ['aberta', 'em_producao', 'pronta', 'instalada', 'finalizada']

export function ServiceOrderForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const isEditing = !!id
  const [statusChange, setStatusChange] = useState('')
  const [statusNotes, setStatusNotes] = useState('')

  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ['clients-all'], queryFn: async () => (await api.get('/clients', { params: { limit: 200 } })).data })
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { limit: 200, active_only: false } })).data })
  const { data: materialTypes = [] } = useQuery<ConfigList[]>({ queryKey: ['config', 'material_type'], queryFn: async () => (await api.get('/config', { params: { category: 'material_type' } })).data })
  const { data: installTypes = [] } = useQuery<ConfigList[]>({ queryKey: ['config', 'installation_type'], queryFn: async () => (await api.get('/config', { params: { category: 'installation_type' } })).data })
  const { data: finishings = [] } = useQuery<ConfigList[]>({ queryKey: ['config', 'finishing'], queryFn: async () => (await api.get('/config', { params: { category: 'finishing' } })).data })
  const { data: paymentMethods = [] } = useQuery<ConfigList[]>({ queryKey: ['config', 'payment_method'], queryFn: async () => (await api.get('/config', { params: { category: 'payment_method' } })).data })

  const { data: os } = useQuery<ServiceOrder>({
    queryKey: ['service-order', id],
    queryFn: async () => (await api.get(`/service-orders/${id}`)).data,
    enabled: isEditing,
  })

  const form = useForm<ServiceOrderFormData>({
    resolver: zodResolver(serviceOrderSchema),
    defaultValues: { client_id: '', items: [] },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' })
  const watchItems = form.watch('items')
  const watchClientId = form.watch('client_id')
  const selectedClient = clients.find((c) => c.id === watchClientId)

  useEffect(() => {
    if (os) {
      form.reset({
        client_id: os.client_id,
        quote_id: os.quote_id ?? undefined,
        deadline: os.deadline ? String(os.deadline) : undefined,
        production_notes: os.production_notes ?? '',
        installation_notes: os.installation_notes ?? '',
        payment_method: os.payment_method ?? '',
        payment_conditions: os.payment_conditions ?? '',
        items: os.items.map((i) => ({
          product_id: i.product_id,
          material_type: i.material_type ?? '',
          installation_type: i.installation_type ?? '',
          finishing: i.finishing ?? '',
          width_m: i.width_m ? Number(i.width_m) : undefined,
          height_m: i.height_m ? Number(i.height_m) : undefined,
          quantity: i.quantity,
          unit_price: Number(i.unit_price),
        })),
      })
    }
  }, [os])

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
    return Number(item.unit_price) * area * Number(item.quantity)
  }

  const totalValue = watchItems.reduce((s, _, i) => s + calcSubtotal(i), 0)

  const mutation = useMutation({
    mutationFn: async (data: ServiceOrderFormData) => {
      const payload = {
        ...data,
        items: data.items.map((item, idx) => ({
          ...item,
          area_m2: item.width_m && item.height_m ? item.width_m * item.height_m : undefined,
          subtotal: calcSubtotal(idx),
        })),
      }
      if (isEditing) return api.put(`/service-orders/${id}`, payload)
      return api.post('/service-orders', payload)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['service-orders'] })
      toast({ title: isEditing ? 'OS atualizada!' : 'OS criada!' })
      if (!isEditing) navigate(`/ordens-de-servico/${res.data.id}`)
    },
    onError: () => toast({ title: 'Erro ao salvar', variant: 'destructive' }),
  })

  const statusMutation = useMutation({
    mutationFn: () => api.patch(`/service-orders/${id}/status`, { status: statusChange, notes: statusNotes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service-order', id] }); toast({ title: 'Status atualizado!' }) },
    onError: () => toast({ title: 'Erro ao atualizar status', variant: 'destructive' }),
  })

  async function downloadPdf() {
    try {
      const res = await api.get(`/pdf/service-order/${id}`, { responseType: 'blob' })
      downloadBlob(res.data, `os-${id}.pdf`)
    } catch { toast({ title: 'Erro ao gerar PDF', variant: 'destructive' }) }
  }

  return (
    <div>
      <PageHeader title={isEditing ? `OS #${String(os?.number ?? '').padStart(5, '0')}` : 'Nova Ordem de Serviço'}>
        <div className="flex gap-2">
          {isEditing && <Button variant="outline" onClick={downloadPdf}><FileDown className="mr-2 h-4 w-4" />PDF</Button>}
          {isEditing && <Button variant="outline" onClick={() => navigate(`/recibos/novo?os_id=${id}`)}><Receipt className="mr-2 h-4 w-4" />Recibo</Button>}
          <Button onClick={form.handleSubmit((d) => mutation.mutate(d))} disabled={mutation.isPending}>
            <Save className="mr-2 h-4 w-4" />{mutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Dados Gerais</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('client_id')}>
                <option value="">Selecione...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {form.formState.errors.client_id && <p className="text-sm text-destructive">{form.formState.errors.client_id.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Prazo de Entrega</Label>
              <Input type="date" {...form.register('deadline')} />
            </div>
            <div className="space-y-2">
              <Label>Forma de Pagamento</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('payment_method')}>
                <option value="">Selecione...</option>
                {paymentMethods.map((m) => <option key={m.id} value={m.value}>{m.value}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Condições</Label>
              <Input placeholder="Ex: À vista, 2x de R$ 500,00" {...form.register('payment_conditions')} />
            </div>
            <div className="space-y-2 md:col-span-2 lg:col-span-1">
              <Label>TOTAL ESTIMADO</Label>
              <p className="text-2xl font-bold text-primary">{formatCurrency(totalValue)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Itens de Produção</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ product_id: '', quantity: 1, unit_price: 0 })}>
              <Plus className="mr-2 h-4 w-4" />Adicionar Item
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left p-2">Produto</th>
                  <th className="p-2">Material</th>
                  <th className="p-2">Instalação</th>
                  <th className="p-2">Acabamento</th>
                  <th className="p-2 w-20">Larg.(m)</th>
                  <th className="p-2 w-20">Alt.(m)</th>
                  <th className="p-2 w-20">Área</th>
                  <th className="p-2 w-16">Qtd</th>
                  <th className="p-2 w-28">Preço Unit.</th>
                  <th className="p-2 w-28 text-right">Subtotal</th>
                  <th className="p-2 w-8"></th>
                </tr></thead>
                <tbody>
                  {fields.map((field, idx) => {
                    const w = Number(form.watch(`items.${idx}.width_m`)) || 0
                    const h = Number(form.watch(`items.${idx}.height_m`)) || 0
                    const area = w > 0 && h > 0 ? (w * h).toFixed(2) : '-'
                    return (
                      <tr key={field.id} className="border-b">
                        <td className="p-1">
                          <select className="w-full border rounded px-2 py-1 text-xs" {...form.register(`items.${idx}.product_id`)}
                            onChange={(e) => { form.setValue(`items.${idx}.product_id`, e.target.value); form.setValue(`items.${idx}.unit_price`, getUnitPrice(e.target.value)) }}>
                            <option value="">Selecione</option>
                            {products.filter(p => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td className="p-1"><select className="w-full border rounded px-2 py-1 text-xs" {...form.register(`items.${idx}.material_type`)}>
                          <option value="">-</option>{materialTypes.map((m) => <option key={m.id} value={m.value}>{m.value}</option>)}
                        </select></td>
                        <td className="p-1"><select className="w-full border rounded px-2 py-1 text-xs" {...form.register(`items.${idx}.installation_type`)}>
                          <option value="">-</option>{installTypes.map((m) => <option key={m.id} value={m.value}>{m.value}</option>)}
                        </select></td>
                        <td className="p-1"><select className="w-full border rounded px-2 py-1 text-xs" {...form.register(`items.${idx}.finishing`)}>
                          <option value="">-</option>{finishings.map((m) => <option key={m.id} value={m.value}>{m.value}</option>)}
                        </select></td>
                        <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs" {...form.register(`items.${idx}.width_m`, { valueAsNumber: true })} /></td>
                        <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs" {...form.register(`items.${idx}.height_m`, { valueAsNumber: true })} /></td>
                        <td className="p-1 text-center text-muted-foreground text-xs">{area}</td>
                        <td className="p-1"><Input type="number" min="1" className="h-7 text-xs" {...form.register(`items.${idx}.quantity`, { valueAsNumber: true })} /></td>
                        <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs" {...form.register(`items.${idx}.unit_price`, { valueAsNumber: true })} /></td>
                        <td className="p-1 text-right font-medium text-xs">{formatCurrency(calcSubtotal(idx))}</td>
                        <td className="p-1"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}><Trash2 className="h-3 w-3 text-destructive" /></Button></td>
                      </tr>
                    )
                  })}
                  {!fields.length && <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">Nenhum item adicionado</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-right">
              <p className="text-xl font-bold text-primary">TOTAL: {formatCurrency(totalValue)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Observações</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Observações de Produção</Label>
              <textarea className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('production_notes')} />
            </div>
            <div className="space-y-2">
              <Label>Observações de Instalação</Label>
              <textarea className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register('installation_notes')} />
            </div>
          </CardContent>
        </Card>

        {isEditing && os && (
          <Card>
            <CardHeader><CardTitle>Status da OS</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">Status atual:</span>
                <Badge variant="info">{osStatusLabel(os.status)}</Badge>
              </div>
              <div className="flex gap-4 items-end">
                <div className="space-y-2">
                  <Label>Alterar para</Label>
                  <select className="flex h-10 border rounded px-3 py-2 text-sm" value={statusChange} onChange={(e) => setStatusChange(e.target.value)}>
                    <option value="">Selecione novo status</option>
                    {OS_STATUSES.filter(s => s !== os.status).map(s => <option key={s} value={s}>{osStatusLabel(s)}</option>)}
                  </select>
                </div>
                <div className="space-y-2 flex-1">
                  <Label>Observação (opcional)</Label>
                  <Input value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder="Motivo da mudança..." />
                </div>
                <Button onClick={() => statusMutation.mutate()} disabled={!statusChange || statusMutation.isPending}>
                  Confirmar
                </Button>
              </div>

              {os.status_history?.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Histórico:</p>
                  <div className="space-y-2">
                    {os.status_history.map((h) => (
                      <div key={h.id} className="flex gap-3 text-sm text-muted-foreground">
                        <span>{formatDate(h.changed_at)}</span>
                        <span>{h.old_status ? `${osStatusLabel(h.old_status)} →` : 'Criada →'}</span>
                        <Badge variant="outline" className="text-xs">{osStatusLabel(h.new_status)}</Badge>
                        {h.notes && <span className="italic">"{h.notes}"</span>}
                        {h.changed_by && <span>por {h.changed_by.name}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
