import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Pencil, Trash2, Plus, Save, Upload, ImageIcon } from 'lucide-react'
import type { Company, ConfigList } from '@/types'

const CATEGORIES = [
  { key: 'material_type', label: 'Tipos de Material' },
  { key: 'installation_type', label: 'Tipos de Instalação' },
  { key: 'finishing', label: 'Acabamentos' },
  { key: 'payment_method', label: 'Formas de Pagamento' },
] as const

function ConfigListTab({ category, label }: { category: string; label: string }) {
  const qc = useQueryClient()
  const [newValue, setNewValue] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const { data = [] } = useQuery<ConfigList[]>({
    queryKey: ['config', category],
    queryFn: async () => (await api.get('/config', { params: { category } })).data,
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/config', { category, value: newValue }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config', category] }); setNewValue(''); toast({ title: 'Item adicionado!' }) },
    onError: (e: any) => toast({ title: 'Erro ao adicionar', description: e?.response?.data?.detail ?? String(e), variant: 'destructive' }),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => api.put(`/config/${id}`, { value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config', category] }); setEditId(null); toast({ title: 'Item atualizado!' }) },
    onError: (e: any) => toast({ title: 'Erro ao atualizar', description: e?.response?.data?.detail ?? String(e), variant: 'destructive' }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/config/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config', category] }); toast({ title: 'Item removido!' }) },
    onError: (e: any) => toast({ title: 'Erro ao remover', description: e?.response?.data?.detail ?? String(e), variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder={`Novo ${label.toLowerCase()}...`} value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newValue && createMutation.mutate()} />
        <Button onClick={() => createMutation.mutate()} disabled={!newValue || createMutation.isPending}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="space-y-2">
        {data.filter(c => c.is_active).map((c) => (
          <div key={c.id} className="flex items-center gap-2 p-2 border rounded-md">
            {editId === c.id ? (
              <>
                <Input className="flex-1" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                <Button size="sm" onClick={() => updateMutation.mutate({ id: c.id, value: editValue })} disabled={updateMutation.isPending}><Save className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" onClick={() => setEditId(null)}>✕</Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{c.value}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(c.id); setEditValue(c.value) }}><Pencil className="h-3 w-3" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteMutation.mutate(c.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
              </>
            )}
          </div>
        ))}
        {!data.filter(c => c.is_active).length && <p className="text-sm text-muted-foreground">Nenhum item cadastrado</p>}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'empresa' | typeof CATEGORIES[number]['key']>('empresa')
  const [company, setCompany] = useState({ name: '', cnpj: '', address: '', phone: '', email: '' })
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoKey, setLogoKey] = useState(0)

  const { data: companyData, isLoading } = useQuery<Company & { has_logo?: boolean }>({
    queryKey: ['company'],
    queryFn: async () => {
      try {
        return (await api.get('/company')).data
      } catch {
        return { id: null, name: '', cnpj: '', address: '', phone: '', email: '', has_logo: false }
      }
    },
  })

  useEffect(() => {
    if (companyData) {
      setCompany({ name: companyData.name || '', cnpj: companyData.cnpj || '', address: companyData.address || '', phone: companyData.phone || '', email: companyData.email || '' })
      if (companyData.has_logo) setLogoPreview(`/api/v1/company/logo?t=${Date.now()}`)
    }
  }, [companyData])

  const saveMutation = useMutation({
    mutationFn: () => api.put('/company', company),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['company'] }); toast({ title: 'Empresa atualizada!' }) },
    onError: (e: any) => toast({ title: 'Erro ao salvar', description: e?.response?.data?.detail ?? String(e), variant: 'destructive' }),
  })

  const logoMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post('/company/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      toast({ title: 'Logo atualizado!' })
      setLogoKey(k => k + 1)
      setLogoPreview(`/api/v1/company/logo?t=${Date.now()}`)
      qc.invalidateQueries({ queryKey: ['company'] })
    },
    onError: (e: any) => toast({ title: 'Erro ao enviar logo', description: e?.response?.data?.detail ?? String(e), variant: 'destructive' }),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    logoMutation.mutate(file)
  }

  if (isLoading) return <PageLoading />

  const tabs = [{ id: 'empresa', label: 'Empresa' }, ...CATEGORIES.map(c => ({ id: c.key, label: c.label }))] as const

  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((t) => (
          <Button key={t.id} variant={tab === t.id ? 'default' : 'outline'} size="sm" onClick={() => setTab(t.id as any)}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'empresa' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Logotipo da Empresa</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6">
                <div className="w-40 h-24 border-2 border-dashed border-muted-foreground/30 rounded-lg flex items-center justify-center bg-muted/20 overflow-hidden">
                  {logoPreview ? (
                    <img key={logoKey} src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" onError={() => setLogoPreview(null)} />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                      <span className="text-xs">Sem logo</span>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">O logotipo aparecerá em todos os documentos (OS, Orçamento, Recibo).</p>
                  <p className="text-xs text-muted-foreground">Formatos: PNG, JPG, SVG. Recomendado: fundo transparente.</p>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={logoMutation.isPending}>
                    <Upload className="mr-2 h-4 w-4" />
                    {logoMutation.isPending ? 'Enviando...' : 'Enviar Logo'}
                  </Button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Dados da Empresa</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Nome / Razão Social</Label><Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>CNPJ</Label><Input value={company.cnpj} onChange={(e) => setCompany({ ...company, cnpj: e.target.value })} /></div>
              <div className="space-y-2 md:col-span-2"><Label>Endereço Completo</Label><Input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></div>
              <div className="space-y-2"><Label>Telefone</Label><Input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></div>
              <div className="md:col-span-2">
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="mr-2 h-4 w-4" />{saveMutation.isPending ? 'Salvando...' : 'Salvar'}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {CATEGORIES.map(({ key, label }) => tab === key && (
        <Card key={key}>
          <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
          <CardContent><ConfigListTab category={key} label={label} /></CardContent>
        </Card>
      ))}
    </div>
  )
}
