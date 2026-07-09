import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCPFCNPJ, formatPhone } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/LoadingSpinner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Client } from '@/types'

interface Props {
  isReseller: boolean
}

export function ClientList({ isReseller }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const debounceTimer = useCallback((value: string) => {
    setSearch(value)
    clearTimeout((window as any)._clientSearchTimer)
    ;(window as any)._clientSearchTimer = setTimeout(() => {
      setDebouncedSearch(value)
    }, 400)
  }, [])

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients', { isReseller, search: debouncedSearch }],
    queryFn: async () => {
      const res = await api.get('/clients', {
        params: { is_reseller: isReseller, search: debouncedSearch || undefined, limit: 200 },
      })
      return res.data
    },
    refetchOnMount: 'always',
    staleTime: 0,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => {
      toast({ title: 'Cliente inativado com sucesso.' })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeleteId(null)
    },
    onError: () => {
      toast({ title: 'Erro ao inativar cliente.', variant: 'destructive' })
    },
  })

  const basePath = isReseller ? '/revendedores' : '/clientes'
  const label = isReseller ? 'Revendedor' : 'Cliente'

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={isReseller ? 'Revendedores' : 'Clientes'}
        description={isReseller ? 'Gerenciar revendedores cadastrados' : 'Gerenciar clientes cadastrados'}
      >
        <Button onClick={() => navigate(`${basePath}/novo`)}>
          Novo {label}
        </Button>
      </PageHeader>

      <div className="flex gap-2">
        <Input
          placeholder="Buscar por nome, CPF/CNPJ..."
          value={search}
          onChange={(e) => debounceTimer(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {isLoading ? (
        <PageLoading />
      ) : (
        <>
          {clients.length === 0 ? (
            <p className="text-center text-gray-400 py-12">Nenhum registro encontrado</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF/CNPJ</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Cidade/UF</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell>{formatCPFCNPJ(client.cpf_cnpj)}</TableCell>
                      <TableCell>{formatPhone(client.phone)}</TableCell>
                      <TableCell>
                        {client.cidade && client.uf ? `${client.cidade}/${client.uf}` : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={client.is_deleted ? 'destructive' : 'default'}>
                          {client.is_deleted ? 'Inativo' : 'Ativo'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`${basePath}/${client.id}/editar`)}
                        >
                          Editar
                        </Button>
                        {!client.is_deleted && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(client.id)}
                          >
                            Inativar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

        </>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Inativar cliente"
        description="Tem certeza que deseja inativar este cliente? Esta ação pode ser revertida."
        confirmLabel="Inativar"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
