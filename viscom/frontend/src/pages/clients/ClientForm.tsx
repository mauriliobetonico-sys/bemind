import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation } from '@tanstack/react-query'
import api from '@/lib/api'
import { maskCPF, maskCNPJ, maskPhone, maskCEP } from '@/lib/utils'
import { clientSchema, type ClientFormData } from '@/lib/validators'
import { toast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  isReseller: boolean
}

export function ClientForm({ isReseller }: Props) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEditing = !!id
  const [cepLoading, setCepLoading] = useState(false)

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const res = await api.get(`/clients/${id}`)
      return res.data
    },
    enabled: isEditing,
  })

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      person_type: 'PF',
      is_reseller: isReseller,
      is_active: true,
    } as any,
  })

  const personType = watch('person_type')
  const isResellerWatch = watch('is_reseller')

  useEffect(() => {
    if (client) {
      reset({
        name: client.name,
        person_type: client.person_type,
        cpf_cnpj: client.cpf_cnpj,
        ie: client.ie ?? '',
        phone: client.phone,
        email: client.email ?? '',
        cep: client.cep ?? '',
        logradouro: client.logradouro ?? '',
        numero: client.numero ?? '',
        bairro: client.bairro ?? '',
        cidade: client.cidade ?? '',
        uf: client.uf ?? '',
        observations: client.observations ?? '',
        is_reseller: client.is_reseller,
        reseller_discount_pct: client.reseller_discount_pct ?? null,
      })
    }
  }, [client, reset])

  const saveMutation = useMutation({
    mutationFn: (data: ClientFormData) =>
      isEditing ? api.patch(`/clients/${id}`, data) : api.post('/clients', data),
    onSuccess: () => {
      toast({ title: `${isReseller ? 'Revendedor' : 'Cliente'} ${isEditing ? 'atualizado' : 'cadastrado'} com sucesso.` })
      navigate(isReseller ? '/revendedores' : '/clientes')
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ')
        : 'Erro ao salvar. Verifique os dados.'
      toast({ title: msg, variant: 'destructive' })
    },
  })

  const fetchCEP = async () => {
    const cep = watch('cep')?.replace(/\D/g, '')
    if (!cep || cep.length !== 8) {
      toast({ title: 'CEP inválido.', variant: 'destructive' })
      return
    }
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const json = await res.json()
      if (json.erro) {
        toast({ title: 'CEP não encontrado.', variant: 'destructive' })
      } else {
        setValue('logradouro', json.logradouro ?? '')
        setValue('bairro', json.bairro ?? '')
        setValue('cidade', json.localidade ?? '')
        setValue('uf', json.uf ?? '')
      }
    } catch {
      toast({ title: 'Erro ao buscar CEP.', variant: 'destructive' })
    } finally {
      setCepLoading(false)
    }
  }

  if (isEditing && clientLoading) return <PageLoading />

  const basePath = isReseller ? '/revendedores' : '/clientes'
  const label = isReseller ? 'Revendedor' : 'Cliente'

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <PageHeader
        title={isEditing ? `Editar ${label}` : `Novo ${label}`}
        description={isEditing ? `Atualizar dados do ${label.toLowerCase()}` : `Cadastrar novo ${label.toLowerCase()}`}
      />

      <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h3 className="font-semibold text-gray-700">Dados Pessoais</h3>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="PF" {...register('person_type')} />
                <span>Pessoa Física</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="PJ" {...register('person_type')} />
                <span>Pessoa Jurídica</span>
              </label>
            </div>
            {errors.person_type && <p className="text-red-500 text-sm">{errors.person_type.message}</p>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 md:col-span-2">
                <Label>Nome {personType === 'PJ' ? '/ Razão Social' : ''}</Label>
                <Input {...register('name')} />
                {errors.name && <p className="text-red-500 text-sm">{errors.name.message}</p>}
              </div>

              <div className="space-y-1">
                <Label>{personType === 'PF' ? 'CPF' : 'CNPJ'}</Label>
                <Input
                  {...register('cpf_cnpj')}
                  onChange={(e) => {
                    const masked = personType === 'PF' ? maskCPF(e.target.value) : maskCNPJ(e.target.value)
                    setValue('cpf_cnpj', masked)
                  }}
                />
                {errors.cpf_cnpj && <p className="text-red-500 text-sm">{errors.cpf_cnpj.message}</p>}
              </div>

              {personType === 'PJ' && (
                <div className="space-y-1">
                  <Label>Inscrição Estadual</Label>
                  <Input {...register('ie')} />
                </div>
              )}

              <div className="space-y-1">
                <Label>Telefone</Label>
                <Input
                  {...register('phone')}
                  onChange={(e) => setValue('phone', maskPhone(e.target.value))}
                />
                {errors.phone && <p className="text-red-500 text-sm">{errors.phone.message}</p>}
              </div>

              <div className="space-y-1">
                <Label>E-mail</Label>
                <Input type="email" {...register('email')} />
                {errors.email && <p className="text-red-500 text-sm">{errors.email.message}</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <h3 className="font-semibold text-gray-700">Endereço</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>CEP</Label>
                <div className="flex gap-2">
                  <Input
                    {...register('cep')}
                    onChange={(e) => setValue('cep', maskCEP(e.target.value))}
                    placeholder="00000-000"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={fetchCEP} disabled={cepLoading}>
                    {cepLoading ? '...' : 'Buscar'}
                  </Button>
                </div>
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label>Logradouro</Label>
                <Input {...register('logradouro')} />
              </div>

              <div className="space-y-1">
                <Label>Número</Label>
                <Input {...register('numero')} />
              </div>

              <div className="space-y-1">
                <Label>Bairro</Label>
                <Input {...register('bairro')} />
              </div>

              <div className="space-y-1">
                <Label>Cidade</Label>
                <Input {...register('cidade')} />
              </div>

              <div className="space-y-1">
                <Label>UF</Label>
                <Input {...register('uf')} maxLength={2} className="uppercase" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <h3 className="font-semibold text-gray-700">Informações Adicionais</h3>

            <div className="space-y-1">
              <Label>Observações</Label>
              <textarea
                {...register('observations')}
                className="w-full border rounded-md p-2 text-sm min-h-[80px] resize-y"
              />
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_reseller" {...register('is_reseller')} />
              <Label htmlFor="is_reseller">É revendedor</Label>
            </div>

            {isResellerWatch && (
              <div className="space-y-1">
                <Label>Desconto Revendedor (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  {...register('reseller_discount_pct', { valueAsNumber: true })}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting || saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(basePath)}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}
