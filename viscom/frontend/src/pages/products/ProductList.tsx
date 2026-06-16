import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import api from '@/lib/api'
import { formatCurrency, unitLabel } from '@/lib/utils'
import { productSchema, type ProductFormData } from '@/lib/validators'
import { toast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Product } from '@/types'

export default function ProductList() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get('/products')
      return res.data
    },
  })

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    watch,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: { is_active: true },
  })

  const saveMutation = useMutation({
    mutationFn: (data: ProductFormData) =>
      editingProduct
        ? api.patch(`/products/${editingProduct.id}`, data)
        : api.post('/products', data),
    onSuccess: () => {
      toast({ title: `Produto ${editingProduct ? 'atualizado' : 'cadastrado'} com sucesso.` })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setDialogOpen(false)
      setEditingProduct(null)
      reset()
    },
    onError: () => {
      toast({ title: 'Erro ao salvar produto.', variant: 'destructive' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      toast({ title: 'Produto removido com sucesso.' })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setDeleteId(null)
    },
    onError: () => {
      toast({ title: 'Erro ao remover produto.', variant: 'destructive' })
    },
  })

  const openCreate = () => {
    setEditingProduct(null)
    reset({ is_active: true, price_client: 0, price_reseller: 0 })
    setDialogOpen(true)
  }

  const openEdit = (p: Product) => {
    setEditingProduct(p)
    reset({
      name: p.name,
      unit: p.unit,
      price_client: p.price_client,
      price_reseller: p.price_reseller,
      is_active: p.is_active,
    })
    setDialogOpen(true)
  }

  const filtered = products.filter((p) => {
    if (filter === 'active') return p.is_active
    if (filter === 'inactive') return !p.is_active
    return true
  })

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Produtos" description="Gerenciar produtos e tabela de preços">
        <Button onClick={openCreate}>Novo Produto</Button>
      </PageHeader>

      <div className="flex gap-2">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Todos' : f === 'active' ? 'Ativos' : 'Inativos'}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <PageLoading />
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Nenhum registro encontrado</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Preço Cliente</TableHead>
                <TableHead>Preço Revenda</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{unitLabel(p.unit)}</TableCell>
                  <TableCell>{formatCurrency(p.price_client)}</TableCell>
                  <TableCell>{formatCurrency(p.price_reseller)}</TableCell>
                  <TableCell>
                    <Badge variant={p.is_active ? 'default' : 'secondary'}>
                      {p.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}>Editar</Button>
                    <Button size="sm" variant="destructive" onClick={() => setDeleteId(p.id)}>Excluir</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditingProduct(null); reset() } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Editar Produto' : 'Novo Produto'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-red-500 text-sm">{errors.name.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Unidade</Label>
              <Select value={watch('unit')} onValueChange={(v) => setValue('unit', v as any)}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="m2">m²</SelectItem>
                  <SelectItem value="unidade">Unidade</SelectItem>
                  <SelectItem value="metro_linear">Metro Linear</SelectItem>
                </SelectContent>
              </Select>
              {errors.unit && <p className="text-red-500 text-sm">{errors.unit.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Preço Cliente (R$)</Label>
                <Input type="number" step="0.01" min="0" {...register('price_client', { valueAsNumber: true })} />
                {errors.price_client && <p className="text-red-500 text-sm">{errors.price_client.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Preço Revenda (R$)</Label>
                <Input type="number" step="0.01" min="0" {...register('price_reseller', { valueAsNumber: true })} />
                {errors.price_reseller && <p className="text-red-500 text-sm">{errors.price_reseller.message}</p>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" {...register('is_active')} />
              <Label htmlFor="is_active">Ativo</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        title="Excluir produto"
        description="Tem certeza que deseja excluir este produto?"
        confirmLabel="Excluir"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
